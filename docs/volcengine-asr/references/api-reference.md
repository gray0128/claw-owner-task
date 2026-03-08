# API 参考文档

## 火山引擎 Seed-ASR 2.0 API

**官方文档**: https://www.volcengine.com/docs/6561/107774

### 端点

| 操作 | 方法 | 路径 |
|------|------|------|
| 提交任务 | POST | `/api/v2/submit` |
| 查询结果 | POST | `/api/v2/query` |

### Host

```
openspeech.volcengineapi.com
```

### 鉴权

使用 AWS V4 签名算法，具体实现见 `scripts/volcengine.js`。

### 提交任务请求示例

```json
{
  "AppId": "your_app_id",
  "EngineModelType": "general",
  "Format": "ogg",
  "Codec": "opus",
  "SampleRate": 16000,
  "Channels": 1,
  "Data": "base64编码的音频数据",
  "Extra": {
    "ShowWords": true
  }
}
```

### EngineModelType 选项

| 值 | 说明 |
|----|------|
| `general` | 通用场景（推荐） |
| `phone_voicecall` | 电话语音场景 |
| `audio` | 音乐/音频场景 |

### 查询结果请求示例

```json
{
  "TaskId": "任务ID"
}
```

### 查询结果响应示例

```json
{
  "TaskId": "xxx",
  "TaskStatus": "Success",
  "Result": [
    {
      "Text": "识别的文本内容",
      "StartTime": 0,
      "EndTime": 1000
    }
  ]
}
```

### TaskStatus 枚举

| 值 | 说明 |
|----|------|
| `Queuing` | 排队中 |
| `Processing` | 处理中 |
| `Success` | 成功 |
| `Failed` | 失败 |

---

## 飞书文件下载 API

**官方文档**: https://open.feishu.cn/document/uAjLw4CM/ukTMukTMukTM/reference/im-v1/file/get

### 端点

```
GET /open-apis/im/v1/files/:file_key
```

### 鉴权

使用飞书应用的 `tenant_access_token`。

### 请求示例

```javascript
const axios = require('axios');

async function getFeishuFile(fileKey, tenantAccessToken) {
  const response = await axios.get(
    `https://open.feishu.cn/open-apis/im/v1/files/${fileKey}`,
    {
      headers: {
        'Authorization': `Bearer ${tenantAccessToken}`
      },
      responseType: 'arraybuffer'
    }
  );
  return response.data;
}
```

### 获取 tenant_access_token

```javascript
async function getTenantAccessToken(appId, appSecret) {
  const response = await axios.post(
    'https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal',
    {
      app_id: appId,
      app_secret: appSecret
    }
  );
  return response.data.tenant_access_token;
}
```
