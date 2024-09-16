import { execSync } from 'child_process';
import path from 'path';
import fs from 'fs';
import axios from 'axios';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 从 .env 文件加载配置
const config = {
    gptApiUrl: process.env.GPT_API_URL,
    gptModel: process.env.GPT_MODEL || 'gpt-4',
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
    const dockerRelatedFiles = extractDockerRelatedFiles(repoPath);
    const keyFiles = await identifyKeyFilesWithGPT(directoryStructure);
    const keyFilesContent = extractKeyFilesContent(repoPath, keyFiles);

    const analysisPrompt = `
Analyze the following project and provide a detailed JSON output to facilitate Dockerfile generation:

Directory Structure:
${directoryStructure}

README Content:
${readmeContent}

Docker-related Files:
${dockerRelatedFiles}

Key Files Content:
${keyFilesContent}

Please provide a comprehensive analysis including, but not limited to:
1. Programming languages and their versions
2. Frameworks and major libraries
3. Build system (e.g., Make, Gradle, npm)
4. Entry point or main executable
5. Required runtime environment
6. Dependencies and how they're managed
7. Configuration files and their purposes
8. Environment variables
9. Exposed ports
10. Volume mount points
11. Build and run commands
12. Testing framework and commands
13. CI/CD pipeline configurations
14. Logging mechanism
15. Project type (e.g., web app, CLI tool, microservice)
16. Scalability considerations
17. Security considerations
18. Any specific deployment requirements

Output the analysis as a JSON object. Use null for unknown values and [] for empty lists. Be as detailed and specific as possible.
`;

    const projectInfoResponse = await callGPTAPIWithRetry(analysisPrompt);
    return JSON.parse(cleanJSONResponse(projectInfoResponse));
}

function extractDockerRelatedFiles(repoPath) {
    const dockerFiles = ['.dockerignore', 'docker-compose.yml', 'Dockerfile'];
    let content = '';
    for (const file of dockerFiles) {
        const filePath = path.join(repoPath, file);
        if (fs.existsSync(filePath)) {
            content += `--- ${file} ---\n`;
            content += fs.readFileSync(filePath, 'utf-8').slice(0, 1000);
            content += '\n\n';
        }
    }
    return content;
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
            content += fs.readFileSync(filePath, 'utf-8').slice(0, 1000);
            content += '\n\n';
        }
    }
    return content;
}

async function generateDockerfileWithGPT(projectInfo, useMultiStage, customTemplate) {
    const prompt = `
Generate a production-ready Dockerfile for the following project:

${JSON.stringify(projectInfo, null, 2)}

Build Type: ${useMultiStage ? 'Multi-stage' : 'Single-stage'}

Guidelines:
1. Base Image: Choose the most appropriate and lightweight official base image. Use specific version tags.
2. Build Environment: Set up the build environment with necessary tools and dependencies.
3. Runtime Environment: Ensure the runtime environment has only what's necessary for the application to run.
4. Security: Implement security best practices (e.g., run as non-root, use least privilege principle).
5. Dependency Management: Install and manage dependencies efficiently, considering caching and layer optimization.
6. Application Setup: Copy application files, set working directory, and configure the application.
7. Entrypoint and CMD: Choose the most appropriate way to start the application based on its type.
8. Ports and Volumes: Expose ports and define volumes only if necessary.
9. Environment Variables: Set required environment variables and provide defaults where appropriate.
10. Healthchecks: Implement a healthcheck if the application supports it.
11. Optimization: Minimize image size and optimize for build and runtime performance.
12. Documentation: Include comments explaining key decisions and usage instructions.

${customTemplate ? `Base Template:\n${customTemplate}\n` : ''}

Consider the following scenarios and adapt the Dockerfile accordingly:
- Web Application: Include web server configuration, consider using application servers if needed.
- API Service: Focus on scalability and performance, consider using a process manager.
- CLI Tool: Provide clear instructions on how to use the tool within the container.
- Background Worker: Implement appropriate process management and logging.
- Stateful Application: Properly handle data persistence and volume management.
- Stateless Application: Optimize for horizontal scalability.

Your response should only contain the Dockerfile content, starting with the FROM instruction. Include helpful comments where necessary.
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
    content = content.trim();
    const fromIndex = content.toLowerCase().indexOf('from');
    if (fromIndex > 0) {
        content = content.substring(fromIndex);
    }
    content = content.replace(/```dockerfile\s*|\s*```/g, '');
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
        if (depth > 5) return;
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
            return fs.readFileSync(filePath, 'utf-8').slice(0, 2000);
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