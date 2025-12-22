#!/bin/bash
# ==============================================================================
# Read it DEEP - 用户管理脚本
# 用于快速查看和修改 SQLite 数据库中的用户账号信息
# ==============================================================================

# 数据库路径
DB_PATH="$(dirname "$0")/../backend/data/readitdeep.db"

# 检查数据库是否存在
if [ ! -f "$DB_PATH" ]; then
    echo "❌ 数据库文件不存在: $DB_PATH"
    echo "请确保后端服务已运行并创建了数据库"
    exit 1
fi

# 显示帮助信息
show_help() {
    echo ""
    echo "📚 Read it DEEP 用户管理工具"
    echo "================================"
    echo ""
    echo "用法: $0 <命令> [参数]"
    echo ""
    echo "命令:"
    echo "  list                    - 列出所有用户"
    echo "  show <email>            - 显示用户详情"
    echo "  reset-password <email>  - 重置用户密码 (交互式输入新密码)"
    echo "  set-admin <email>       - 将用户设为管理员"
    echo "  set-user <email>        - 将用户设为普通用户"
    echo "  activate <email>        - 激活用户"
    echo "  deactivate <email>      - 停用用户"
    echo "  set-plan <email> <plan> - 设置用户计划 (free/pro/ultra)"
    echo "  sql                     - 进入 SQLite 交互模式"
    echo ""
    echo "示例:"
    echo "  $0 list"
    echo "  $0 show admin@readitdeep.com"
    echo "  $0 reset-password admin@readitdeep.com"
    echo "  $0 set-plan user@example.com pro"
    echo ""
}

# 列出所有用户
list_users() {
    echo ""
    echo "📋 所有用户列表"
    echo "============================================================"
    sqlite3 -header -column "$DB_PATH" "
        SELECT 
            id,
            email, 
            username,
            role,
            plan,
            is_active,
            datetime(created_at) as created_at
        FROM users 
        ORDER BY created_at DESC;
    "
    echo ""
}

# 显示用户详情
show_user() {
    local email="$1"
    if [ -z "$email" ]; then
        echo "❌ 请提供用户邮箱"
        echo "用法: $0 show <email>"
        exit 1
    fi
    
    echo ""
    echo "👤 用户详情: $email"
    echo "============================================================"
    sqlite3 -header -column "$DB_PATH" "
        SELECT 
            id,
            email,
            username,
            role,
            is_active,
            plan,
            datetime(plan_expires_at) as plan_expires,
            daily_papers_used,
            daily_ai_used,
            monthly_papers_used,
            datetime(created_at) as created_at,
            datetime(last_login) as last_login
        FROM users 
        WHERE email = '$email';
    "
    echo ""
}

# 重置密码 (使用 Python bcrypt)
reset_password() {
    local email="$1"
    if [ -z "$email" ]; then
        echo "❌ 请提供用户邮箱"
        echo "用法: $0 reset-password <email>"
        exit 1
    fi
    
    # 检查用户是否存在
    user_exists=$(sqlite3 "$DB_PATH" "SELECT COUNT(*) FROM users WHERE email = '$email';")
    if [ "$user_exists" -eq 0 ]; then
        echo "❌ 用户不存在: $email"
        exit 1
    fi
    
    # 交互式输入新密码
    echo -n "🔑 请输入新密码: "
    read -s new_password
    echo ""
    
    if [ -z "$new_password" ]; then
        echo "❌ 密码不能为空"
        exit 1
    fi
    
    echo -n "🔑 请再次输入新密码: "
    read -s confirm_password
    echo ""
    
    if [ "$new_password" != "$confirm_password" ]; then
        echo "❌ 两次输入的密码不一致"
        exit 1
    fi
    
    # 使用 Python 生成 bcrypt 哈希
    password_hash=$(python3 -c "
import bcrypt
password = '''$new_password'''
salt = bcrypt.gensalt()
hashed = bcrypt.hashpw(password.encode('utf-8'), salt)
print(hashed.decode('utf-8'))
")
    
    if [ -z "$password_hash" ]; then
        echo "❌ 无法生成密码哈希，请确保已安装 bcrypt"
        echo "   运行: pip install bcrypt"
        exit 1
    fi
    
    # 更新数据库
    sqlite3 "$DB_PATH" "UPDATE users SET password_hash = '$password_hash', updated_at = datetime('now') WHERE email = '$email';"
    
    echo "✅ 密码已重置: $email"
}

# 设置用户角色
set_role() {
    local email="$1"
    local role="$2"
    
    if [ -z "$email" ]; then
        echo "❌ 请提供用户邮箱"
        exit 1
    fi
    
    sqlite3 "$DB_PATH" "UPDATE users SET role = '$role', updated_at = datetime('now') WHERE email = '$email';"
    echo "✅ 用户 $email 的角色已设置为: $role"
}

# 设置用户状态
set_active() {
    local email="$1"
    local active="$2"
    
    if [ -z "$email" ]; then
        echo "❌ 请提供用户邮箱"
        exit 1
    fi
    
    sqlite3 "$DB_PATH" "UPDATE users SET is_active = $active, updated_at = datetime('now') WHERE email = '$email';"
    
    if [ "$active" -eq 1 ]; then
        echo "✅ 用户 $email 已激活"
    else
        echo "✅ 用户 $email 已停用"
    fi
}

# 设置用户计划
set_plan() {
    local email="$1"
    local plan="$2"
    
    if [ -z "$email" ] || [ -z "$plan" ]; then
        echo "❌ 请提供用户邮箱和计划"
        echo "用法: $0 set-plan <email> <plan>"
        echo "计划选项: free, pro, ultra"
        exit 1
    fi
    
    case "$plan" in
        free|pro|ultra)
            sqlite3 "$DB_PATH" "UPDATE users SET plan = '$plan', updated_at = datetime('now') WHERE email = '$email';"
            echo "✅ 用户 $email 的计划已设置为: $plan"
            ;;
        *)
            echo "❌ 无效的计划: $plan"
            echo "有效选项: free, pro, ultra"
            exit 1
            ;;
    esac
}

# 进入 SQL 交互模式
sql_mode() {
    echo ""
    echo "📦 进入 SQLite 交互模式"
    echo "数据库: $DB_PATH"
    echo "输入 .quit 退出"
    echo ""
    sqlite3 -header -column "$DB_PATH"
}

# 主函数
main() {
    case "$1" in
        list)
            list_users
            ;;
        show)
            show_user "$2"
            ;;
        reset-password)
            reset_password "$2"
            ;;
        set-admin)
            set_role "$2" "admin"
            ;;
        set-user)
            set_role "$2" "user"
            ;;
        activate)
            set_active "$2" 1
            ;;
        deactivate)
            set_active "$2" 0
            ;;
        set-plan)
            set_plan "$2" "$3"
            ;;
        sql)
            sql_mode
            ;;
        -h|--help|help|"")
            show_help
            ;;
        *)
            echo "❌ 未知命令: $1"
            show_help
            exit 1
            ;;
    esac
}

main "$@"
