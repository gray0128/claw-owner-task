/**
 * 本地 OGG 文件测试脚本
 * 使用项目中的 OGG 音频文件，走完 R2 上传 → 火山引擎 ASR 识别 的完整流程
 *
 * 用法:
 *   node test.js                      # 默认测试 test-audio.ogg
 *   node test.js test-keshan.ogg      # 指定文件
 *   node test.js all                  # 测试所有 OGG 文件
 */

const fs = require('fs').promises;
const path = require('path');

const os = require('os');

// 从 openclaw.json 加载环境变量
function loadConfig() {
    try {
        const configPath = path.join(os.homedir(), '.openclaw', 'openclaw.json');
        const envRaw = require('fs').readFileSync(configPath, 'utf-8');
        const envContent = JSON.parse(envRaw);
        const skillEnv =
            envContent?.skills?.entries?.['volcengine-asr']?.env ||
            envContent?.skills?.entries?.['doubao-asr']?.env;
        if (skillEnv) {
            console.log('[测试] 已从 openclaw.json 加载环境配置');
            return skillEnv;
        }
    } catch (e) {
        console.warn(`[测试] 无法加载配置: ${e.message}`);
    }
    return {};
}

const skillConfig = loadConfig();

const { submitTask, waitForResult } = require('./scripts/volcengine');
const { uploadWithAutoCleanup } = require('./scripts/s3-client');

/**
 * 根据文件扩展名推断音频格式参数 (与 index.js 中的逻辑一致)
 */
function inferAudioFormat(filePath, contentType) {
    const ext = path.extname(filePath).toLowerCase();
    if (ext === '.ogg' || contentType?.includes('ogg')) {
        return { format: 'ogg', codec: 'opus', ext: '.ogg', mime: 'audio/ogg' };
    }
    if (ext === '.mp3' || contentType?.includes('mp3') || contentType?.includes('mpeg')) {
        return { format: 'mp3', codec: 'raw', ext: '.mp3', mime: 'audio/mpeg' };
    }
    if (ext === '.wav' || contentType?.includes('wav')) {
        return { format: 'wav', codec: 'raw', ext: '.wav', mime: 'audio/wav' };
    }
    if (ext === '.m4a' || contentType?.includes('m4a') || contentType?.includes('mp4')) {
        return { format: 'mp3', codec: 'raw', ext: '.m4a', mime: 'audio/mp4' };
    }
    return { format: 'ogg', codec: 'opus', ext, mime: contentType || 'audio/ogg' };
}

/**
 * 测试单个文件
 */
async function testFile(filePath) {
    const fileName = path.basename(filePath);
    const divider = '='.repeat(60);

    console.log(`\n${divider}`);
    console.log(`  测试文件: ${fileName}`);
    console.log(divider);

    // 1. 读取音频文件
    console.log('\n[1/4] 读取音频文件...');
    const fileBuffer = await fs.readFile(filePath);
    console.log(`  文件大小: ${(fileBuffer.length / 1024).toFixed(1)} KB`);

    // 2. 推断音频格式
    console.log('\n[2/4] 推断音频格式...');
    const audioFormat = inferAudioFormat(filePath, 'audio/ogg');
    console.log(`  格式: ${JSON.stringify(audioFormat)}`);

    // 3. 上传到 R2
    console.log('\n[3/4] 上传到 R2...');
    const startUpload = Date.now();
    const r2Result = await uploadWithAutoCleanup(fileBuffer, audioFormat.mime, audioFormat.ext, skillConfig);
    const uploadTime = ((Date.now() - startUpload) / 1000).toFixed(2);
    console.log(`  R2 URL: ${r2Result.url.substring(0, 80)}...`);
    console.log(`  上传耗时: ${uploadTime}s`);

    // 4. 提交 ASR 任务并等待结果
    console.log('\n[4/4] 提交火山引擎 ASR 任务...');
    const startASR = Date.now();
    const requestId = await submitTask(r2Result.url, {
        format: audioFormat.format,
        codec: audioFormat.codec,
        rate: 16000,
        channel: 1,
    }, skillConfig);
    console.log(`  任务 ID: ${requestId}`);
    console.log('  等待识别结果...');

    const transcriptText = await waitForResult(requestId, skillConfig);
    const asrTime = ((Date.now() - startASR) / 1000).toFixed(2);

    console.log(`\n  识别耗时: ${asrTime}s`);
    console.log(`  识别结果:\n`);
    console.log(`  >>> ${transcriptText} <<<\n`);

    return { fileName, transcriptText, uploadTime, asrTime };
}

/**
 * 主函数
 */
async function main() {
    const arg = process.argv[2] || 'test-audio.ogg';

    let files;
    if (arg === 'all') {
        // 查找目录下所有 .ogg 文件
        const dirEntries = await fs.readdir(__dirname);
        files = dirEntries
            .filter(f => f.endsWith('.ogg'))
            .map(f => path.join(__dirname, f));
    } else {
        const filePath = path.isAbsolute(arg) ? arg : path.join(__dirname, arg);
        files = [filePath];
    }

    if (files.length === 0) {
        console.error('[错误] 未找到任何 OGG 文件');
        process.exit(1);
    }

    console.log(`\n准备测试 ${files.length} 个文件...\n`);

    const results = [];
    for (const file of files) {
        try {
            const result = await testFile(file);
            results.push(result);
        } catch (err) {
            console.error(`\n[错误] 测试 ${path.basename(file)} 失败:`, err.message);
            results.push({ fileName: path.basename(file), error: err.message });
        }
    }

    // 汇总结果
    if (results.length > 1) {
        console.log('\n' + '='.repeat(60));
        console.log('  测试汇总');
        console.log('='.repeat(60));
        for (const r of results) {
            if (r.error) {
                console.log(`  [FAIL] ${r.fileName}: ${r.error}`);
            } else {
                console.log(`  [PASS] ${r.fileName} (上传:${r.uploadTime}s, ASR:${r.asrTime}s)`);
                console.log(`         "${r.transcriptText}"`);
            }
        }
    }

    console.log('\n测试完成!\n');
}

main().catch(err => {
    console.error('[致命错误]', err);
    process.exit(1);
});
