#!/usr/bin/env bash
set -euo pipefail

# =============================================================================
# Volcengine ASR Plugin 安装脚本
# 使用方式: curl -fsSL <URL>/install.sh | bash
# =============================================================================

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
BOLD='\033[1m'
DIM='\033[2m'
NC='\033[0m' # 重置颜色

# 图标
CHECK="${GREEN}[OK]${NC}"
CROSS="${RED}[X]${NC}"
INFO="${BLUE}[i]${NC}"
WARN="${YELLOW}[!]${NC}"

# 默认配置
REPO_URL="https://github.com/gray0128/volcengine-asr.git"
OPENCLAW_DIR="${OPENCLAW_DIR:-$HOME/.openclaw}"
PLUGIN_NAME="volcengine-asr"
PLUGIN_DIR=""
CONFIG_FILE=""

# -----------------------------------------------------------------------------
# 工具函数
# -----------------------------------------------------------------------------

print_banner() {
    echo ""
    echo -e "${CYAN}${BOLD}"
    echo "  ╔══════════════════════════════════════════╗"
    echo "  ║        Volcengine ASR Installer          ║"
    echo "  ║   火山引擎 Seed-ASR 2.0 语音识别插件    ║"
    echo "  ╚══════════════════════════════════════════╝"
    echo -e "${NC}"
}

print_step() {
    echo -e "\n${BOLD}[$1/$TOTAL_STEPS] $2${NC}"
    echo -e "${DIM}$(printf '%.0s─' {1..50})${NC}"
}

# 打开 /dev/tty 作为 fd 3，用于在 curl | bash 场景下读取用户输入
exec 3</dev/tty 2>/dev/null || exec 3<&0

prompt_input() {
    local prompt="$1"
    local var_name="$2"
    local default="${3:-}"
    local is_secret="${4:-false}"

    if [ -n "$default" ]; then
        echo -ne "  ${prompt} ${DIM}(默认: ${default})${NC}: " 
    else
        echo -ne "  ${prompt}: " 
    fi

    local input_value=""
    if [ "$is_secret" = "true" ]; then
        read -rs input_value <&3 || true
        echo "" 
    else
        read -r input_value <&3 || true
    fi

    if [ -z "$input_value" ] && [ -n "$default" ]; then
        input_value="$default"
    fi

    eval "$var_name='$input_value'"
}

prompt_yes_no() {
    local prompt="$1"
    local default="${2:-y}"

    if [ "$default" = "y" ]; then
        echo -ne "  ${prompt} ${DIM}[Y/n]${NC}: " 
    else
        echo -ne "  ${prompt} ${DIM}[y/N]${NC}: " 
    fi

    local answer=""
    read -r answer <&3 || true
    answer="${answer:-$default}"

    case "$answer" in
        [Yy]* ) return 0 ;;
        * ) return 1 ;;
    esac
}

check_command() {
    if command -v "$1" &> /dev/null; then
        echo -e "  $CHECK $1 $(command -v "$1")"
        return 0
    else
        echo -e "  $CROSS $1 未找到"
        return 1
    fi
}

# -----------------------------------------------------------------------------
# 步骤 1: 环境检查
# -----------------------------------------------------------------------------

check_prerequisites() {
    print_step 1 "检查运行环境"

    local has_error=false

    check_command "node" || has_error=true
    check_command "npm" || has_error=true
    check_command "git" || has_error=true

    if [ "$has_error" = true ]; then
        echo -e "\n  $CROSS 缺少必要的依赖，请先安装后重试"
        exit 1
    fi

    # 检查 Node.js 版本
    local node_version
    node_version=$(node -v | sed 's/v//' | cut -d. -f1)
    if [ "$node_version" -lt 18 ]; then
        echo -e "  $CROSS Node.js 版本需要 >= 18，当前: $(node -v)"
        exit 1
    fi
    echo -e "  $CHECK Node.js 版本: $(node -v)"
}

# -----------------------------------------------------------------------------
# 步骤 2: 确定安装位置
# -----------------------------------------------------------------------------

detect_install_path() {
    print_step 2 "确定安装位置"

    # 检测 OpenClaw 目录
    if [ -d "$OPENCLAW_DIR" ]; then
        echo -e "  $CHECK 检测到 OpenClaw 目录: ${OPENCLAW_DIR}"
    else
        echo -e "  $WARN 未检测到 OpenClaw 目录: ${OPENCLAW_DIR}"
        if prompt_yes_no "是否使用该路径创建?" "y"; then
            mkdir -p "$OPENCLAW_DIR"
            echo -e "  $CHECK 已创建: ${OPENCLAW_DIR}"
        else
            prompt_input "请输入 OpenClaw 目录路径" OPENCLAW_DIR
            mkdir -p "$OPENCLAW_DIR"
        fi
    fi

    PLUGIN_DIR="${OPENCLAW_DIR}/plugins-source/${PLUGIN_NAME}"
    CONFIG_FILE="${OPENCLAW_DIR}/openclaw.json"

    echo -e "  ${INFO} Plugin 安装目录: ${PLUGIN_DIR}"
    echo -e "  ${INFO} 配置文件路径: ${CONFIG_FILE}"

    # 检查是否已安装
    UPDATE_MODE=false
    if [ -d "$PLUGIN_DIR" ]; then
        echo -e "\n  ${INFO} Plugin 已安装: ${PLUGIN_DIR}"
        echo -e "  ${BOLD}请选择操作:${NC}"
        echo -e "    1) 更新 (git pull + npm install)"
        echo -e "    2) 覆盖安装 (删除后重新克隆)"
        echo -e "    3) 取消"
        prompt_input "请选择" UPDATE_CHOICE "1"

        case "$UPDATE_CHOICE" in
            1)
                UPDATE_MODE=true
                echo -e "  ${INFO} 将执行更新..."
                ;;
            2)
                rm -rf "$PLUGIN_DIR"
                echo -e "  ${INFO} 已删除旧版本，将重新安装..."
                ;;
            *)
                echo -e "  安装已取消"
                exit 0
                ;;
        esac
    fi
}

# -----------------------------------------------------------------------------
# 步骤 3: 配置参数
# -----------------------------------------------------------------------------

collect_config() {
    if [ "$UPDATE_MODE" = true ]; then
        SKIP_CONFIG=true
        return
    fi

    print_step 3 "配置 Plugin 参数"

    echo -e "  ${INFO} 安装此 Plugin 需要以下配置:"
    echo ""
    echo -e "  ${BOLD}必需参数:${NC}"
    echo -e "    - VOLC_API_KEY        火山引擎 API Key (UUID 格式)"
    echo -e "    - S3_ENDPOINT         S3 兼容存储端点 URL"
    echo -e "    - S3_ACCESS_KEY_ID    S3 Access Key ID"
    echo -e "    - S3_SECRET_ACCESS_KEY S3 Secret Access Key"
    echo -e "    - S3_BUCKET           S3 Bucket 名称"
    echo ""
    echo -e "  ${BOLD}可选参数:${NC}"
    echo -e "    - S3_REGION           S3 区域 (默认: auto)"
    echo -e "    - S3_PUBLIC_URL       S3 自定义公开域名"
    echo -e "    - VOLC_RESOURCE_ID    模型 Resource ID (默认: volc.seedasr.auc)"
    echo ""

    SKIP_CONFIG=false
    if ! prompt_yes_no "现在配置这些参数?" "y"; then
        SKIP_CONFIG=true
        echo -e "\n  ${INFO} 已跳过配置，安装完成后请手动添加"
        return
    fi

    echo -e "\n  ${BOLD}-- 火山引擎配置 --${NC}"
    prompt_input "VOLC_API_KEY" VOLC_API_KEY
    while [ -z "${VOLC_API_KEY:-}" ]; do
        echo -e "  ${WARN} VOLC_API_KEY 为必填项"
        prompt_input "VOLC_API_KEY" VOLC_API_KEY
    done
    prompt_input "VOLC_RESOURCE_ID" VOLC_RESOURCE_ID "volc.seedasr.auc"

    echo -e "\n  ${BOLD}-- S3 配置 --${NC}"
    prompt_input "S3_ENDPOINT" S3_ENDPOINT
    while [ -z "${S3_ENDPOINT:-}" ]; do
        echo -e "  ${WARN} S3_ENDPOINT 为必填项"
        prompt_input "S3_ENDPOINT" S3_ENDPOINT
    done
    prompt_input "S3_ACCESS_KEY_ID" S3_ACCESS_KEY_ID
    while [ -z "${S3_ACCESS_KEY_ID:-}" ]; do
        echo -e "  ${WARN} S3_ACCESS_KEY_ID 为必填项"
        prompt_input "S3_ACCESS_KEY_ID" S3_ACCESS_KEY_ID
    done
    prompt_input "S3_SECRET_ACCESS_KEY" S3_SECRET_ACCESS_KEY
    while [ -z "${S3_SECRET_ACCESS_KEY:-}" ]; do
        echo -e "  ${WARN} S3_SECRET_ACCESS_KEY 为必填项"
        prompt_input "S3_SECRET_ACCESS_KEY" S3_SECRET_ACCESS_KEY
    done
    prompt_input "S3_BUCKET" S3_BUCKET "volcengine-asr"
    prompt_input "S3_REGION" S3_REGION "auto"
    prompt_input "S3_PUBLIC_URL (可选，直接回车跳过)" S3_PUBLIC_URL ""
}

# -----------------------------------------------------------------------------
# 步骤 4: 下载并安装
# -----------------------------------------------------------------------------

install_plugin() {
    if [ "$UPDATE_MODE" = true ]; then
        print_step 4 "更新 Plugin"

        echo -e "  正在拉取最新代码..."
        cd "$PLUGIN_DIR"
        git pull 2>&1 | while read -r line; do
            echo -e "  ${DIM}${line}${NC}"
        done
        echo -e "  $CHECK 代码更新完成"

        echo -e "  正在更新依赖..."
        npm install --production 2>&1 | tail -1 | while read -r line; do
            echo -e "  ${DIM}${line}${NC}"
        done
        echo -e "  $CHECK 依赖更新完成"
    else
        print_step 4 "下载并安装 Plugin"

        echo -e "  正在克隆仓库..."
        mkdir -p "$(dirname "$PLUGIN_DIR")"
        git clone --depth 1 "$REPO_URL" "$PLUGIN_DIR" 2>&1 | while read -r line; do
            echo -e "  ${DIM}${line}${NC}"
        done
        echo -e "  $CHECK 仓库克隆完成"

        echo -e "  正在安装依赖..."
        cd "$PLUGIN_DIR"
        npm install --production 2>&1 | tail -1 | while read -r line; do
            echo -e "  ${DIM}${line}${NC}"
        done
                echo -e "  $CHECK 依赖安装完成"

        echo -e "  正在注册 Plugin..."
        if command -v openclaw &> /dev/null; then
            openclaw plugins install "$PLUGIN_DIR" 2>&1 | while read -r line; do
                echo -e "  ${DIM}${line}${NC}"
            done
            echo -e "  $CHECK Plugin 注册完成"
        else
            echo -e "  $WARN 未检测到 openclaw 命令，请稍后手动执行: openclaw plugins install $PLUGIN_DIR"
        fi
    fi
}

# -----------------------------------------------------------------------------
# 步骤 5: 写入配置
# -----------------------------------------------------------------------------

write_config() {
    print_step 5 "写入配置"

    if [ "$SKIP_CONFIG" = true ]; then
        echo -e "  ${INFO} 已跳过自动配置"
        print_manual_config_guide
        return
    fi

    # 构建 env JSON 片段
    local env_json="{"
    env_json+="\"VOLC_API_KEY\":\"${VOLC_API_KEY}\""

    if [ "${VOLC_RESOURCE_ID}" != "volc.seedasr.auc" ]; then
        env_json+=",\"VOLC_RESOURCE_ID\":\"${VOLC_RESOURCE_ID}\""
    fi

    env_json+=",\"S3_ENDPOINT\":\"${S3_ENDPOINT}\""
    env_json+=",\"S3_ACCESS_KEY_ID\":\"${S3_ACCESS_KEY_ID}\""
    env_json+=",\"S3_SECRET_ACCESS_KEY\":\"${S3_SECRET_ACCESS_KEY}\""

    if [ "${S3_BUCKET}" != "volcengine-asr" ]; then
        env_json+=",\"S3_BUCKET\":\"${S3_BUCKET}\""
    fi

    if [ "${S3_REGION}" != "auto" ]; then
        env_json+=",\"S3_REGION\":\"${S3_REGION}\""
    fi

    if [ -n "${S3_PUBLIC_URL:-}" ]; then
        env_json+=",\"S3_PUBLIC_URL\":\"${S3_PUBLIC_URL}\""
    fi

    env_json+="}"

    # 构建 plugin 配置片段
    local plugin_json="{\"enabled\":true,\"config\":${env_json}}"

    if [ -f "$CONFIG_FILE" ]; then
        echo -e "  ${INFO} 检测到已有配置文件: ${CONFIG_FILE}"
        # 使用 node 合并 JSON 配置
        node -e "
const fs = require('fs');
const config = JSON.parse(fs.readFileSync('${CONFIG_FILE}', 'utf8'));
if (!config.plugins) config.plugins = {};
if (!config.plugins.entries) config.plugins.entries = {};
config.plugins.entries['${PLUGIN_NAME}'] = ${plugin_json};
fs.writeFileSync('${CONFIG_FILE}', JSON.stringify(config, null, 2) + '\n');
console.log('  配置已合并写入');
"
    else
        echo -e "  ${INFO} 创建新配置文件: ${CONFIG_FILE}"
        node -e "
const fs = require('fs');
const config = { plugins: { entries: { '${PLUGIN_NAME}': ${plugin_json} } } };
fs.writeFileSync('${CONFIG_FILE}', JSON.stringify(config, null, 2) + '\n');
console.log('  配置已写入');
"
    fi

    echo -e "  $CHECK 配置写入完成"
}

# -----------------------------------------------------------------------------
# 手动配置引导
# -----------------------------------------------------------------------------

print_manual_config_guide() {
    echo ""
    echo -e "  ${BOLD}手动配置方法:${NC}"
    echo ""
    echo -e "  编辑 OpenClaw 配置文件:"
    echo -e "  ${CYAN}${CONFIG_FILE}${NC}"
    echo ""
    echo -e "  在配置文件中添加或合并以下内容到 ${BOLD}plugins.entries${NC} 字段:"
    echo ""
    echo -e "  ${DIM}// ${CONFIG_FILE}${NC}"
    echo -e "  {"
    echo -e "    \"plugins\": {"
    echo -e "      \"entries\": {"
    echo -e "        ${YELLOW}\"volcengine-asr\": {${NC}"
    echo -e "          ${YELLOW}\"enabled\": true,${NC}"
    echo -e "          ${YELLOW}\"config\": {${NC}"
    echo -e "            ${YELLOW}\"VOLC_API_KEY\": \"你的火山引擎API Key\",${NC}"
    echo -e "            ${YELLOW}\"S3_ENDPOINT\": \"你的S3端点URL\",${NC}"
    echo -e "            ${YELLOW}\"S3_ACCESS_KEY_ID\": \"你的S3 Access Key ID\",${NC}"
    echo -e "            ${YELLOW}\"S3_SECRET_ACCESS_KEY\": \"你的S3 Secret Access Key\",${NC}"
    echo -e "            ${YELLOW}\"S3_BUCKET\": \"你的S3 Bucket名称\",${NC}"
    echo -e "            ${YELLOW}\"S3_REGION\": \"auto\"${NC}"
    echo -e "          ${YELLOW}}${NC}"
    echo -e "        ${YELLOW}}${NC}"
    echo -e "      }"
    echo -e "    }"
    echo -e "  }"
    echo ""
}

# -----------------------------------------------------------------------------
# 步骤 6: 重启网关
# -----------------------------------------------------------------------------

restart_gateway() {
    print_step 6 "重启 OpenClaw 网关"

    # 检测可用的重启方式
    local has_openclaw=false
    local has_systemctl=false

    if command -v openclaw &> /dev/null; then
        has_openclaw=true
    fi
    if command -v systemctl &> /dev/null; then
        has_systemctl=true
    fi

    if ! prompt_yes_no "是否现在重启 OpenClaw 网关?" "y"; then
        echo -e "\n  ${INFO} 已跳过重启，请稍后手动执行以下任一命令:"
        echo ""
        if [ "$has_openclaw" = true ]; then
            echo -e "  ${CYAN}openclaw gateway restart${NC}"
        else
            echo -e "  ${DIM}# 如果安装了 openclaw CLI:${NC}"
            echo -e "  ${CYAN}openclaw gateway restart${NC}"
        fi
        echo ""
        if [ "$has_systemctl" = true ]; then
            echo -e "  ${DIM}# 或者通过 systemctl:${NC}"
            echo -e "  ${CYAN}systemctl --user restart openclaw-gateway${NC}"
        else
            echo -e "  ${DIM}# 或者通过 systemctl:${NC}"
            echo -e "  ${CYAN}systemctl --user restart openclaw-gateway${NC}"
        fi
        echo ""
        SKIP_RESTART=true
        return
    fi

    SKIP_RESTART=false

    # 尝试重启
    if [ "$has_openclaw" = true ]; then
        echo -e "  正在通过 openclaw CLI 重启网关..."
        if openclaw gateway restart 2>&1 | while read -r line; do
            echo -e "  ${DIM}${line}${NC}"
        done; then
            echo -e "  $CHECK 网关已重启"
            return
        else
            echo -e "  $WARN openclaw CLI 重启失败，尝试 systemctl..."
        fi
    fi

    if [ "$has_systemctl" = true ]; then
        echo -e "  正在通过 systemctl 重启网关..."
        if systemctl --user restart openclaw-gateway 2>&1 | while read -r line; do
            echo -e "  ${DIM}${line}${NC}"
        done; then
            echo -e "  $CHECK 网关已重启"
            return
        else
            echo -e "  $WARN systemctl 重启失败"
        fi
    fi

    if [ "$has_openclaw" = false ] && [ "$has_systemctl" = false ]; then
        echo -e "  $WARN 未检测到 openclaw CLI 或 systemctl"
        echo -e "  ${INFO} 请手动重启 OpenClaw 网关:"
        echo -e "  ${CYAN}openclaw gateway restart${NC}"
        echo -e "  ${DIM}# 或${NC}"
        echo -e "  ${CYAN}systemctl --user restart openclaw-gateway${NC}"
        SKIP_RESTART=true
    fi
}

# -----------------------------------------------------------------------------
# 完成提示
# -----------------------------------------------------------------------------

print_success() {
    echo ""
    echo -e "${GREEN}${BOLD}"
    echo "  ╔══════════════════════════════════════════╗"
    echo "  ║           安装完成!                      ║"
    echo "  ╚══════════════════════════════════════════╝"
    echo -e "${NC}"
    echo -e "  ${INFO} Plugin 路径: ${CYAN}${PLUGIN_DIR}${NC}"
    echo -e "  ${INFO} 配置文件:   ${CYAN}${CONFIG_FILE}${NC}"
    echo ""
    echo -e "  ${BOLD}下一步:${NC}"

    local step=1

    if [ "$SKIP_CONFIG" = true ]; then
        echo -e "  ${step}. 按上方提示编辑 ${CYAN}${CONFIG_FILE}${NC} 添加配置"
        step=$((step + 1))
    fi

    if [ "${SKIP_RESTART:-false}" = true ]; then
        echo -e "  ${step}. 按上方提示重启 OpenClaw 网关"
        step=$((step + 1))
    fi

    echo -e "  ${step}. 发送一条语音消息测试"
    echo ""
}

# -----------------------------------------------------------------------------
# 主流程
# -----------------------------------------------------------------------------

TOTAL_STEPS=6

main() {
    print_banner
    check_prerequisites
    detect_install_path
    collect_config
    install_plugin
    write_config
    restart_gateway
    print_success
}

main
