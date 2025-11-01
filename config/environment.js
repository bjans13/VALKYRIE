const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

const environmentName = (process.env.NODE_ENV || 'development').toLowerCase();
const rootDir = process.cwd();

const envFiles = [
    '.env',
    `.env.${environmentName}`,
    '.env.local',
    `.env.${environmentName}.local`,
];

const loadedFiles = [];

for (const filename of envFiles) {
    const filePath = path.resolve(rootDir, filename);
    if (fs.existsSync(filePath)) {
        dotenv.config({ path: filePath, override: true });
        loadedFiles.push(filePath);
    }
}

module.exports = {
    name: environmentName,
    loadedFiles,
    isProduction: environmentName === 'production',
    isDevelopment: environmentName === 'development',
};
