#!/usr/bin/env python3
"""
魔搭创空间启动脚本
使用 Python 启动 Node.js 服务器
"""

import subprocess
import os
import sys

def main():
    """启动 Node.js 服务器"""
    print("🚀 Starting Meetmind on ModelScope Studios...")
    
    # 设置环境变量
    env = os.environ.copy()
    env['NODE_ENV'] = 'production'
    env['HOST'] = '0.0.0.0'
    env['PORT'] = '7860'
    
    print(f"🌐 Server will listen on {env['HOST']}:{env['PORT']}")
    
    try:
        # 启动 Node.js 服务器
        print("🎯 Starting Node.js server...")
        subprocess.run(['node', 'server.js'], env=env, check=True)
    except subprocess.CalledProcessError as e:
        print(f"❌ Error: {e}")
        sys.exit(1)
    except KeyboardInterrupt:
        print("\n👋 Server stopped")
        sys.exit(0)

if __name__ == '__main__':
    main()
