const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const axios = require('axios');
require('dotenv').config();

// 从 .env 文件加载配置
const config = {
    gptApiUrl: process.env.GPT_API_URL,
    gptModel: process.env.GPT_MODEL || 'gpt-4o-mini',
    defaultUseMultiStage: process.env.DEFAULT_USE_MULTI_STAGE === 'true',
    maxRetries: parseInt(process.env.MAX_RETRIES || '3', 10),
    retryDelay: parseInt(process.env.RETRY_DELAY || '1000', 10),
};

// 验证必要的配置
if (!config.gptApiUrl) {
    console.error('错误: GPT_API_URL 未在 .env 文件中设置');
    process.exit(1);
}

async function generateDockerfileForRepo(repoUrl, options = {}) {
    const { useMultiStage = config.defaultUseMultiStage, templatePath } = options;
    console.log(`[开始] 准备为 ${repoUrl} 生成 Dockerfile (${useMultiStage ? '多阶段' : '单阶段'}构建)`);

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
6. Ports that need to be exposed (if any)
7. Environment variables (if any)
8. Potential volume mounts needed (if any)

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
Based on the following project directory structure, list up to 10 files that are most important for understanding the project structure and configuration. Please return only file paths, separated by commas. Prioritize configuration files, main entry points, and key source files.

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
Generate a Dockerfile for the following project, suitable for a production environment.

${useMultiStage 
    ? 'IMPORTANT: Use a multi-stage build to optimize the image size. Include exactly two stages: a build stage and a final stage.'
    : 'IMPORTANT: Use a single-stage build only. Do not include any multi-stage build instructions.'}

Guidelines:
1. Choose appropriate base image(s), preferring official lightweight images.
2. Set the working directory, copy necessary files, and install dependencies.
3. Run the application as a non-root user if possible.
4. Set necessary environment variables.
5. Only expose ports if required (e.g., for web services or APIs).
6. Use ENTRYPOINT and/or CMD to start the application.
7. Add a health check if appropriate for the application type.

Project information:
${JSON.stringify(projectInfo, null, 2)}

${customTemplate ? `Base your Dockerfile on this template, adapting as needed:\n${customTemplate}` : ''}

Strict instructions:
1. Output ONLY the Dockerfile content. No explanations, quotes, or Markdown.
2. Do NOT include any comments in the Dockerfile.
3. Ensure the Dockerfile is specific to this project's needs.
4. ${useMultiStage ? 'Use EXACTLY two stages: "builder" and "final".' : 'Use only ONE stage. Do NOT include any "AS" statements for naming stages.'}
5. Keep the Dockerfile concise and efficient.
6. If the project does not require exposed ports, do not include EXPOSE instruction.
7. Only include necessary ENV instructions based on the project information.

Begin Dockerfile content:
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

    function traverse(dir, prefix = '', depth = 0) {
        if (depth > 5) return; // 限制递归深度
        const files = fs.readdirSync(dir);
        files.forEach((file, index) => {
            if (ignoreDirs.includes(file)) return;
            const filePath = path.join(dir, file);
            const stats = fs.statSync(filePath);
            const isLast = index === files.length - 1;
            const newPrefix = prefix + (isLast ? '└── ' : '├── ');
            structure += newPrefix + file + '\n';
            if (stats.isDirectory()) {
                traverse(filePath, prefix + (isLast ? '    ' : '│   '), depth + 1);
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

async function main() {
    const args = process.argv.slice(2);
    
    if (args.length === 0) {
        console.error('请提供一个仓库 URL。使用方法: node app.js <repo_url> [--multi-stage] [--template <path>]');
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