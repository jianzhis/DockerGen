import { Octokit } from "@octokit/rest";
import sodium from 'libsodium-wrappers';
import fs from 'fs';
import { execSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import dotenv from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config();

const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });

async function createOrUpdateSecret(owner, repo, secretName, secretValue) {
  try {
    // Get the public key of the repository
    const { data: publicKey } = await octokit.actions.getRepoPublicKey({
      owner,
      repo,
    });

    // Encrypt the secret using the public key
    await sodium.ready;
    const binKey = sodium.from_base64(publicKey.key, sodium.base64_variants.ORIGINAL);
    const binSecret = sodium.from_string(secretValue);
    const encBytes = sodium.crypto_box_seal(binSecret, binKey);
    const encrypted_value = sodium.to_base64(encBytes, sodium.base64_variants.ORIGINAL);

    // Create or update the secret
    await octokit.actions.createOrUpdateRepoSecret({
      owner,
      repo,
      secret_name: secretName,
      encrypted_value: encrypted_value,
      key_id: publicKey.key_id,
    });
    console.log(`Secret '${secretName}' created or updated successfully.`);
  } catch (error) {
    console.error(`Error creating/updating secret '${secretName}':`, error.message);
    throw error;
  }
}

function parseRepoUrl(repoUrl) {
  try {
    const url = new URL(repoUrl);
    const pathParts = url.pathname.split('/').filter(Boolean);
    if (pathParts.length < 2) {
      throw new Error('Invalid GitHub repository URL');
    }
    return {
      owner: pathParts[0],
      repo: pathParts[1].replace('.git', '')
    };
  } catch (error) {
    throw new Error('Invalid GitHub repository URL');
  }
}

async function verifyGitHubAccess() {
  try {
    const { data: user } = await octokit.users.getAuthenticated();
    console.log(`Authenticated as GitHub user: ${user.login}`);
    return true;
  } catch (error) {
    console.error('Failed to authenticate with GitHub:', error.message);
    return false;
  }
}

async function main() {
  console.log('Starting the process...');
  
  if (!process.env.GITHUB_TOKEN) {
    console.error('GITHUB_TOKEN is not set in the environment variables.');
    process.exit(1);
  }

  if (!await verifyGitHubAccess()) {
    console.error('Failed to verify GitHub access. Please check your token.');
    process.exit(1);
  }

  const args = process.argv.slice(2);
  if (args.length !== 1) {
    console.error('Usage: node main.js <GitHub_repo_URL>');
    process.exit(1);
  }

  const repoUrl = args[0];
  let owner, repo;

  try {
    ({ owner, repo } = parseRepoUrl(repoUrl));
    console.log(`Parsed repository: ${owner}/${repo}`);
  } catch (error) {
    console.error('Error parsing repository URL:', error.message);
    process.exit(1);
  }

  try {
    const newRepoName = `${repo.toLowerCase()}-dockerfile-${Date.now()}`;
    console.log(`Attempting to fork repository: ${owner}/${repo} as ${newRepoName}`);
    const fork = await octokit.repos.createFork({ 
      owner, 
      repo,
      name: newRepoName
    });
    console.log(`Forked repository: ${fork.data.html_url}`);

    // 使用实际的 fork 名称
    const actualRepoName = fork.data.name.toLowerCase();
    console.log(`Actual forked repository name: ${actualRepoName}`);

    // Wait for the fork to be ready
    console.log('Waiting for fork to be ready...');
    await new Promise(resolve => setTimeout(resolve, 15000));

    console.log(`Cloning repository: ${fork.data.clone_url}`);
    execSync(`git clone ${fork.data.clone_url}`, { stdio: 'inherit' });
    console.log(`Cloned repository to ./${actualRepoName}`);

    // Generate Dockerfile
    console.log('Generating Dockerfile...');
    execSync(`node app.js ./${actualRepoName}`, { stdio: 'inherit' });
    console.log('Generated Dockerfile');

    // Create GitHub Actions workflow
    console.log('Creating GitHub Actions workflow...');
    const workflowYaml = `
name: Docker Build and Push

on:
  push:
    branches: [ main ]
  workflow_dispatch:

jobs:
  build-and-push:
    runs-on: ubuntu-latest
    steps:
    - name: Checkout code
      uses: actions/checkout@v2

    - name: Set up Docker Buildx
      uses: docker/setup-buildx-action@v1

    - name: Login to DockerHub
      uses: docker/login-action@v1
      with:
        username: \${{ secrets.DOCKERHUB_USERNAME }}
        password: \${{ secrets.DOCKERHUB_PASSWORD }}

    - name: Build and push
      uses: docker/build-push-action@v2
      with:
        context: .
        push: true
        tags: \${{ secrets.DOCKERHUB_USERNAME }}/${actualRepoName}:latest
    `;

    // Write workflow file
    const workflowDir = path.join(`./${actualRepoName}`, '.github/workflows');
    fs.mkdirSync(workflowDir, { recursive: true });
    fs.writeFileSync(path.join(workflowDir, 'docker-build-push.yml'), workflowYaml);
    console.log('Created GitHub Actions workflow file');

    // Create secrets in the forked repository
    console.log('Creating secrets in the forked repository...');
    await createOrUpdateSecret(fork.data.owner.login, actualRepoName, 'DOCKERHUB_USERNAME', process.env.DOCKERHUB_USERNAME);
    await createOrUpdateSecret(fork.data.owner.login, actualRepoName, 'DOCKERHUB_PASSWORD', process.env.DOCKERHUB_PASSWORD);
    console.log('Created secrets in the forked repository');

    // Commit and push changes
    console.log('Committing and pushing changes...');
    process.chdir(`./${actualRepoName}`);
    execSync('git config user.name "GitHub Action"', { stdio: 'inherit' });
    execSync('git config user.email "action@github.com"', { stdio: 'inherit' });
    execSync('git add .', { stdio: 'inherit' });
    execSync('git commit -m "Add Dockerfile and GitHub Actions workflow"', { stdio: 'inherit' });
    
    // 在 push 之前先 pull
    execSync('git pull --rebase origin main', { stdio: 'inherit' });
    
    execSync(`git push https://x-access-token:${process.env.GITHUB_TOKEN}@github.com/${fork.data.full_name}.git`, { stdio: 'inherit' });
    console.log('Pushed changes to the forked repository');

    console.log(`Forked, cloned, and updated repository: ${fork.data.html_url}`);
    console.log('GitHub Actions workflow has been added. It will build and push the Docker image on the next push to main.');
  } catch (error) {
    console.error('An error occurred:', error.message);
    if (error.response) {
      console.error('Error response:', JSON.stringify(error.response.data, null, 2));
    }
    process.exit(1);
  }
}

main().catch(error => {
  console.error('Unhandled error:', error);
  process.exit(1);
});