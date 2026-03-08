/**
 * S3 兼容对象存储客户端
 * 用于将本地音频文件上传到 S3 兼容存储（Cloudflare R2、AWS S3、MinIO 等），通过预签名 URL 提供临时公开访问
 */

const { S3Client, PutObjectCommand, DeleteObjectCommand, GetObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const crypto = require('crypto');

const PRESIGN_EXPIRES = 600; // 预签名 URL 有效期 10 分钟
const CLEANUP_MS = 15 * 60 * 1000; // 15 分钟后清理文件

function getS3Client(skillConfig) {
    const endpoint = skillConfig?.S3_ENDPOINT;
    const accessKeyId = skillConfig?.S3_ACCESS_KEY_ID;
    const secretAccessKey = skillConfig?.S3_SECRET_ACCESS_KEY;
    const region = skillConfig?.S3_REGION || 'auto';

    if (!endpoint || !accessKeyId || !secretAccessKey) {
        throw new Error('S3 配置不完整，需要 S3_ENDPOINT, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY');
    }

    return new S3Client({
        region,
        endpoint,
        credentials: {
            accessKeyId,
            secretAccessKey,
        },
        forcePathStyle: true,
    });
}

/**
 * 上传文件到 S3 并返回预签名 URL
 * @param {Buffer} fileBuffer - 文件内容
 * @param {string} contentType - MIME 类型
 * @param {string} [ext] - 文件扩展名
 * @returns {Promise<{key: string, url: string}>}
 */
async function uploadAudio(fileBuffer, contentType, ext = '.ogg', skillConfig = {}) {
    const client = getS3Client(skillConfig);
    const key = `audio/${crypto.randomUUID()}${ext}`;
    const bucketName = skillConfig?.S3_BUCKET || 'volcengine-asr';

    // 上传文件
    await client.send(new PutObjectCommand({
        Bucket: bucketName,
        Key: key,
        Body: fileBuffer,
        ContentType: contentType,
    }));

    // 生成访问 URL
    let url;
    const publicBase = skillConfig?.S3_PUBLIC_URL;
    if (publicBase) {
        // 自定义域名（公开访问），无需签名
        url = `${publicBase}/${key}`;
    } else {
        // 无自定义域名，使用预签名 URL（临时公开访问）
        url = await getSignedUrl(client, new GetObjectCommand({
            Bucket: bucketName,
            Key: key,
        }), { expiresIn: PRESIGN_EXPIRES });
    }

    console.log(`[S3] 已上传: ${key} (${(fileBuffer.length / 1024).toFixed(1)} KB)`);
    return { key, url };
}

/**
 * 删除 S3 上的文件
 */
async function deleteAudio(key, skillConfig = {}) {
    try {
        const client = getS3Client(skillConfig);
        const bucketName = skillConfig?.S3_BUCKET || 'volcengine-asr';
        await client.send(new DeleteObjectCommand({
            Bucket: bucketName,
            Key: key,
        }));
        console.log(`[S3] 已清理: ${key}`);
    } catch (err) {
        console.warn(`[S3] 清理失败 (${key}):`, err.message);
    }
}

/**
 * 上传并设置自动清理
 */
async function uploadWithAutoCleanup(fileBuffer, contentType, ext = '.ogg', skillConfig = {}) {
    const result = await uploadAudio(fileBuffer, contentType, ext, skillConfig);

    // 异步定时清理
    setTimeout(() => {
        deleteAudio(result.key, skillConfig).catch(() => { });
    }, CLEANUP_MS);

    return result;
}

module.exports = {
    uploadAudio,
    deleteAudio,
    uploadWithAutoCleanup,
};
