#!/usr/bin/env node
/**
 * Security Scanner - автоматическое сканирование Docker образов и npm зависимостей
 * 
 * Запуск: node scripts/security-scan.js [--fix] [--ci]
 * 
 * Опции:
 *   --fix   Автоматически исправить найденные уязвимости где возможно
 *   --ci    Режим CI/CD - вернуть exit code 1 при критических уязвимостях
 */

const { execSync, spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// Конфигурация
const CONFIG = {
    // Сервисы с package.json для npm audit
    npmServices: [
        'frontend',
        'backend/api-gateway',
        'backend/auth-service',
        'backend/database-service',
        'backend/upload-service',
        'backend/playlist-service',
        'backend/lyrics-service',
        'backend/recommendations-service',
        'backend/track-processor'
    ],

    // Docker образы для сканирования
    dockerImages: [
        'music-platform-frontend',
        'music-platform-api-gateway',
        'music-platform-auth-service',
        'music-platform-upload-service',
        'music-platform-database-service',
        'music-platform-artist-service',
        'music-platform-recommendations-service',
        'music-platform-track-processor',
        'music-platform-reco-offline-worker'
    ],

    // Уровни severity для блокировки в CI
    blockingSeverity: ['critical', 'high'],

    // Максимально допустимое количество уязвимостей по уровню
    maxVulnerabilities: {
        critical: 0,
        high: 0,
        medium: 10,
        low: 50
    }
};

// Цвета для консоли
const colors = {
    reset: '\x1b[0m',
    red: '\x1b[31m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    magenta: '\x1b[35m',
    cyan: '\x1b[36m',
    bold: '\x1b[1m'
};

function log(message, color = 'reset') {
    console.log(`${colors[color]}${message}${colors.reset}`);
}

function logSection(title) {
    console.log('\n' + '='.repeat(60));
    log(title, 'cyan');
    console.log('='.repeat(60));
}

function runCommand(command, cwd = process.cwd(), silent = false) {
    try {
        const result = execSync(command, {
            cwd,
            encoding: 'utf8',
            stdio: silent ? 'pipe' : 'inherit',
            timeout: 120000
        });
        return { success: true, output: result };
    } catch (error) {
        return {
            success: false,
            output: error.stdout || '',
            error: error.stderr || error.message
        };
    }
}

function runCommandWithOutput(command, cwd = process.cwd()) {
    try {
        const result = execSync(command, {
            cwd,
            encoding: 'utf8',
            stdio: 'pipe',
            timeout: 120000
        });
        return { success: true, output: result };
    } catch (error) {
        return {
            success: false,
            output: error.stdout || '',
            error: error.stderr || error.message
        };
    }
}

/**
 * Сканирование npm зависимостей с npm audit
 */
async function scanNpmDependencies(fix = false) {
    logSection('🔍 NPM Security Audit');

    const results = {
        total: 0,
        critical: 0,
        high: 0,
        medium: 0,
        low: 0,
        fixed: 0,
        services: []
    };

    const rootDir = path.resolve(__dirname, '..');

    for (const service of CONFIG.npmServices) {
        const servicePath = path.join(rootDir, service);
        const packageJsonPath = path.join(servicePath, 'package.json');

        if (!fs.existsSync(packageJsonPath)) {
            log(`  ⚠ Skipping ${service} - no package.json`, 'yellow');
            continue;
        }

        log(`\n📦 Scanning ${service}...`, 'blue');

        // Запуск npm audit
        const auditResult = runCommandWithOutput('npm audit --json 2>&1', servicePath);

        let auditData = { vulnerabilities: {} };
        try {
            // npm audit возвращает JSON даже при ошибках
            const jsonMatch = auditResult.output.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                auditData = JSON.parse(jsonMatch[0]);
            }
        } catch (e) {
            // Если не удалось распарсить, продолжаем
        }

        const vulnSummary = auditData.metadata?.vulnerabilities || {
            critical: 0,
            high: 0,
            moderate: 0,
            low: 0
        };

        const serviceResult = {
            name: service,
            critical: vulnSummary.critical || 0,
            high: vulnSummary.high || 0,
            medium: vulnSummary.moderate || 0,
            low: vulnSummary.low || 0,
            total: (vulnSummary.critical || 0) + (vulnSummary.high || 0) +
                (vulnSummary.moderate || 0) + (vulnSummary.low || 0)
        };

        results.critical += serviceResult.critical;
        results.high += serviceResult.high;
        results.medium += serviceResult.medium;
        results.low += serviceResult.low;
        results.total += serviceResult.total;

        if (serviceResult.total === 0) {
            log(`  ✅ No vulnerabilities found`, 'green');
        } else {
            const summary = [];
            if (serviceResult.critical > 0) summary.push(`${serviceResult.critical} critical`);
            if (serviceResult.high > 0) summary.push(`${serviceResult.high} high`);
            if (serviceResult.medium > 0) summary.push(`${serviceResult.medium} medium`);
            if (serviceResult.low > 0) summary.push(`${serviceResult.low} low`);

            const color = serviceResult.critical > 0 || serviceResult.high > 0 ? 'red' : 'yellow';
            log(`  ⚠ Found: ${summary.join(', ')}`, color);

            // Автоисправление если указан флаг --fix
            if (fix && serviceResult.total > 0) {
                log(`  🔧 Running npm audit fix...`, 'blue');
                const fixResult = runCommand('npm audit fix --force 2>&1', servicePath, true);
                if (fixResult.success) {
                    log(`  ✅ Auto-fix applied`, 'green');
                    results.fixed++;
                } else {
                    log(`  ⚠ Some issues could not be auto-fixed`, 'yellow');
                }
            }
        }

        results.services.push(serviceResult);
    }

    return results;
}

/**
 * Сканирование Docker образов с Docker Scout
 */
async function scanDockerImages() {
    logSection('🐳 Docker Image Security Scan');

    const results = {
        total: 0,
        critical: 0,
        high: 0,
        medium: 0,
        low: 0,
        images: []
    };

    // Проверяем доступность Docker Scout
    const scoutCheck = runCommandWithOutput('docker scout version 2>&1');
    if (!scoutCheck.success || scoutCheck.output.includes('not found')) {
        log('⚠ Docker Scout not available. Install with: docker scout plugin install', 'yellow');
        return results;
    }

    for (const image of CONFIG.dockerImages) {
        log(`\n🔍 Scanning ${image}:latest...`, 'blue');

        // Проверяем существование образа
        const imageCheck = runCommandWithOutput(`docker image inspect ${image}:latest 2>&1`);
        if (!imageCheck.success) {
            log(`  ⚠ Image not found, skipping`, 'yellow');
            continue;
        }

        // Сканирование с Docker Scout
        const scanResult = runCommandWithOutput(
            `docker scout cves ${image}:latest --only-severity critical,high --format json 2>&1`
        );

        let vulnData = { vulnerabilities: [] };
        try {
            // Пытаемся извлечь JSON из вывода
            const jsonMatch = scanResult.output.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                vulnData = JSON.parse(jsonMatch[0]);
            }
        } catch (e) {
            // Парсим текстовый вывод
            const criticalMatch = scanResult.output.match(/(\d+)C/);
            const highMatch = scanResult.output.match(/(\d+)H/);
            const mediumMatch = scanResult.output.match(/(\d+)M/);
            const lowMatch = scanResult.output.match(/(\d+)L/);

            vulnData = {
                critical: criticalMatch ? parseInt(criticalMatch[1]) : 0,
                high: highMatch ? parseInt(highMatch[1]) : 0,
                medium: mediumMatch ? parseInt(mediumMatch[1]) : 0,
                low: lowMatch ? parseInt(lowMatch[1]) : 0
            };
        }

        const imageResult = {
            name: image,
            critical: vulnData.critical || 0,
            high: vulnData.high || 0,
            medium: vulnData.medium || 0,
            low: vulnData.low || 0,
            total: (vulnData.critical || 0) + (vulnData.high || 0) +
                (vulnData.medium || 0) + (vulnData.low || 0)
        };

        results.critical += imageResult.critical;
        results.high += imageResult.high;
        results.medium += imageResult.medium;
        results.low += imageResult.low;
        results.total += imageResult.total;

        if (imageResult.critical === 0 && imageResult.high === 0) {
            log(`  ✅ No critical/high vulnerabilities`, 'green');
        } else {
            const summary = [];
            if (imageResult.critical > 0) summary.push(`${imageResult.critical} critical`);
            if (imageResult.high > 0) summary.push(`${imageResult.high} high`);

            log(`  ❌ Found: ${summary.join(', ')}`, 'red');
        }

        results.images.push(imageResult);
    }

    return results;
}

/**
 * Генерация отчёта
 */
function generateReport(npmResults, dockerResults) {
    logSection('📊 Security Scan Report');

    console.log('\n--- NPM Dependencies ---');
    console.log(`Total vulnerabilities: ${npmResults.total}`);
    console.log(`  Critical: ${npmResults.critical}`);
    console.log(`  High: ${npmResults.high}`);
    console.log(`  Medium: ${npmResults.medium}`);
    console.log(`  Low: ${npmResults.low}`);

    if (npmResults.fixed > 0) {
        log(`  Auto-fixed: ${npmResults.fixed} services`, 'green');
    }

    console.log('\n--- Docker Images ---');
    console.log(`Total vulnerabilities: ${dockerResults.total}`);
    console.log(`  Critical: ${dockerResults.critical}`);
    console.log(`  High: ${dockerResults.high}`);
    console.log(`  Medium: ${dockerResults.medium}`);
    console.log(`  Low: ${dockerResults.low}`);

    // Сохранение отчёта в файл
    const report = {
        timestamp: new Date().toISOString(),
        npm: npmResults,
        docker: dockerResults,
        summary: {
            totalVulnerabilities: npmResults.total + dockerResults.total,
            critical: npmResults.critical + dockerResults.critical,
            high: npmResults.high + dockerResults.high,
            medium: npmResults.medium + dockerResults.medium,
            low: npmResults.low + dockerResults.low,
            passed: (npmResults.critical + dockerResults.critical) === 0 &&
                (npmResults.high + dockerResults.high) === 0
        }
    };

    const reportPath = path.join(__dirname, '..', 'security-report.json');
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
    log(`\n📄 Report saved to: security-report.json`, 'blue');

    return report;
}

/**
 * Главная функция
 */
async function main() {
    const args = process.argv.slice(2);
    const fix = args.includes('--fix');
    const ci = args.includes('--ci');

    log('\n🛡️  Music Platform Security Scanner', 'bold');
    log(`Mode: ${fix ? 'Auto-fix enabled' : 'Scan only'} | ${ci ? 'CI mode' : 'Interactive'}`, 'magenta');

    // Сканирование npm
    const npmResults = await scanNpmDependencies(fix);

    // Сканирование Docker
    const dockerResults = await scanDockerImages();

    // Генерация отчёта
    const report = generateReport(npmResults, dockerResults);

    // Итоговый статус
    console.log('\n' + '='.repeat(60));
    if (report.summary.passed) {
        log('✅ SECURITY CHECK PASSED - No critical/high vulnerabilities', 'green');
    } else {
        log('❌ SECURITY CHECK FAILED - Critical/high vulnerabilities found', 'red');
        log('\nRecommended actions:', 'yellow');
        log('1. Run: node scripts/security-scan.js --fix', 'yellow');
        log('2. Update vulnerable packages manually', 'yellow');
        log('3. Rebuild Docker images: docker-compose build --no-cache --pull', 'yellow');
    }
    console.log('='.repeat(60) + '\n');

    // Exit code для CI
    if (ci && !report.summary.passed) {
        process.exit(1);
    }
}

main().catch(error => {
    console.error('Security scan failed:', error);
    process.exit(1);
});
