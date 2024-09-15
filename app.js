const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const axios = require('axios');
require('dotenv').config();

// 从 .env 文件加载配置
const config = {
    gptApiUrl: process.env.GPT_API_URL,
    gptModel: process.env.GPT_MODEL || 'gpt-4o-mini',
    defaultUseMultiStage: process.env.DEFAULT_USE_MULTI_STAGE === 'false',
    maxRetries: parseInt(process.env.MAX_RETRIES || '3', 10),
    retryDelay: parseInt(process.env.RETRY_DELAY || '1000', 10),
};

async function generateDockerfileForRepo(repoUrl, options = {}) {
    const { useMultiStage = config.defaultUseMultiStage, templatePath } = options;
    console.log(`[开始] 准备为 ${repoUrl} 生成 Dockerfile`);

    const repoPath = cloneRepository(repoUrl);
    if (!repoPath) return;

    try {
        console.log('[分析] 正在分析项目结构');
        const projectInfo = await analyzeProjectWithGPT(repoPath);

        console.log('[生成] 正在生成 Dockerfile');
        const customTemplate = templatePath ? loadCustomTemplate(templatePath) : null;
        const dockerfileContent = await generateDockerfileWithGPT(projectInfo, useMultiStage, customTemplate);

        if (dockerfileContent) {
            const dockerfilePath = path.join(repoPath, 'Dockerfile');
            fs.writeFileSync(dockerfilePath, dockerfileContent, 'utf-8');
            console.log(`[完成] Dockerfile 已生成: ${dockerfilePath}`);
            console.log('生成的 Dockerfile 内容：\n', dockerfileContent);
        } else {
            console.log('[错误] 未能生成有效的 Dockerfile');
        }
    } catch (error) {
        console.error('[错误] 生成 Dockerfile 过程中出错:', error.message);
    }
}

async function analyzeProjectWithGPT(repoPath) {
    const directoryStructure = generateDirectoryStructure(repoPath);
    const readmeContent = extractReadme(repoPath);
    const keyFiles = await identifyKeyFilesWithGPT(directoryStructure);
    const keyFilesContent = extractKeyFilesContent(repoPath, keyFiles);

    const analysisPrompt = `
Analyze the following project information and output the result in JSON format:
1. Programming language used
2. Main dependency management files (e.g., requirements.txt, package.json, composer.json, etc.)
3. Possible entry point file
4. Build commands
5. Run commands
6. Ports that need to be exposed
7. Environment variables
8. Potential volume mounts needed

Directory structure:
${directoryStructure}

README content:
${readmeContent}

Key files content:
${keyFilesContent}

Please ensure the output is valid JSON format without any additional formatting or code block markers.
`;

    const projectInfoResponse = await callGPTAPIWithRetry(analysisPrompt);
    return JSON.parse(cleanJSONResponse(projectInfoResponse));
}

async function identifyKeyFilesWithGPT(directoryStructure) {
    const prompt = `
Based on the following project directory structure, list 5-10 files that are most important for understanding the project structure and configuration. Please return only file paths, separated by commas.

${directoryStructure}
`;

    const response = await callGPTAPIWithRetry(prompt);
    return response.split(',').map(file => file.trim());
}

function extractKeyFilesContent(repoPath, keyFiles) {
    let content = '';
    for (const file of keyFiles) {
        const filePath = path.join(repoPath, file);
        if (fs.existsSync(filePath)) {
            content += `--- ${file} ---\n`;
            content += fs.readFileSync(filePath, 'utf-8').slice(0, 1000); // 限制每个文件的内容
            content += '\n\n';
        }
    }
    return content;
}

async function generateDockerfileWithGPT(projectInfo, useMultiStage, customTemplate) {
    const prompt = `
Based on the following project information, generate a Dockerfile suitable for a production environment. ${useMultiStage ? 'Use multi-stage builds to optimize image size.' : 'Use a single-stage build to keep the Dockerfile simple.'} Please consider the following points:
1. Choose an appropriate base image, preferring official lightweight images
2. Correctly set the working directory, copy necessary files, and install dependencies
3. Run the application as a non-root user
4. Set necessary environment variables
5. Expose required ports
6. Use ENTRYPOINT and/or CMD to properly start the application
7. Consider adding a health check

Project information:
${JSON.stringify(projectInfo, null, 2)}

${customTemplate ? `Please generate the Dockerfile based on the following template, making appropriate modifications as needed:\n${customTemplate}` : ''}

Please output only the content of the Dockerfile, without any explanations, quotation marks, or Markdown formatting.
`;

    const response = await callGPTAPIWithRetry(prompt);
    return cleanDockerfileContent(response);
}

async function callGPTAPIWithRetry(prompt) {
    for (let i = 0; i < config.maxRetries; i++) {
        try {
            const response = await axios.post(config.gptApiUrl, {
                model: config.gptModel,
                messages: [{ role: 'user', content: prompt }],
                stream: false
            }, {
                headers: { 'Content-Type': 'application/json' }
            });
            return response.data.choices[0].message.content.trim();
        } catch (error) {
            console.error(`API 调用失败 (尝试 ${i + 1}/${config.maxRetries}): ${error.message}`);
            if (i === config.maxRetries - 1) throw error;
            await new Promise(res => setTimeout(res, config.retryDelay));
        }
    }
}

function cleanJSONResponse(response) {
    let cleaned = response.replace(/```json\s*|\s*```/g, '');
    const startIndex = cleaned.indexOf('{');
    const endIndex = cleaned.lastIndexOf('}');
    
    if (startIndex !== -1 && endIndex !== -1 && endIndex > startIndex) {
        cleaned = cleaned.slice(startIndex, endIndex + 1);
    }
    
    return cleaned;
}

function cleanDockerfileContent(content) {
    content = content.replace(/```Dockerfile\s*|\s*```/g, '');
    content = content.trim();
    if ((content.startsWith('"') && content.endsWith('"')) || 
        (content.startsWith("'") && content.endsWith("'"))) {
        content = content.slice(1, -1);
    }
    return content;
}

function generateDirectoryStructure(repoPath) {
    const ignoreDirs = ['.git', 'node_modules', 'venv', '.venv'];
    let structure = '';

    function traverse(dir, prefix = '') {
        const files = fs.readdirSync(dir);
        files.forEach((file, index) => {
            if (ignoreDirs.includes(file)) return;
            const filePath = path.join(dir, file);
            const stats = fs.statSync(filePath);
            const isLast = index === files.length - 1;
            const newPrefix = prefix + (isLast ? '└── ' : '├── ');
            structure += newPrefix + file + '\n';
            if (stats.isDirectory()) {
                traverse(filePath, prefix + (isLast ? '    ' : '│   '));
            }
        });
    }

    traverse(repoPath);
    return structure;
}

function extractReadme(repoPath) {
    const readmeFiles = ['README.md', 'README.rst', 'README.txt'];
    for (const file of readmeFiles) {
        const filePath = path.join(repoPath, file);
        if (fs.existsSync(filePath)) {
            return fs.readFileSync(filePath, 'utf-8').slice(0, 2000); // 限制 README 内容
        }
    }
    return '';
}

function cloneRepository(repoUrl) {
    const repoName = repoUrl.split('/').pop().replace('.git', '');
    const repoPath = path.join(__dirname, repoName);
    
    if (fs.existsSync(repoPath)) {
        console.log(`仓库 ${repoName} 已存在，跳过克隆。`);
        return repoPath;
    }

    try {
        console.log(`正在克隆 ${repoUrl}...`);
        execSync(`git clone --depth 1 ${repoUrl}`, { stdio: 'inherit' });
        return repoPath;
    } catch (error) {
        console.error('克隆仓库时出错：', error.message);
        return null;
    }
}

function loadCustomTemplate(templatePath) {
    if (fs.existsSync(templatePath)) {
        return fs.readFileSync(templatePath, 'utf-8');
    }
    console.warn(`模板文件 ${templatePath} 不存在，将使用默认模板。`);
    return null;
}

// 主函数调用
async function main() {
    // 获取命令行参数
    const args = process.argv.slice(2);
    
    if (args.length === 0) {
        console.error('请提供一个仓库 URL。使用方法: node app.js <repo_url>');
        process.exit(1);
    }

    const repoUrl = args[0];
    const useMultiStage = args.includes('--multi-stage') ? true : config.defaultUseMultiStage;
    const templatePath = args.includes('--template') ? args[args.indexOf('--template') + 1] : process.env.TEMPLATE_PATH;

    await generateDockerfileForRepo(repoUrl, { 
        useMultiStage,
        templatePath
    });
}

main().catch(error => {
    console.error('程序执行出错:', error);
    process.exit(1);
});