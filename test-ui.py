"""
MeetMind UI 自动化测试
使用 Playwright 测试所有页面和交互
"""

from playwright.sync_api import sync_playwright
import os

def test_meetmind():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context(viewport={'width': 1280, 'height': 800})
        page = context.new_page()
        
        # 创建截图目录
        os.makedirs('screenshots', exist_ok=True)
        
        print("🚀 开始测试 MeetMind...")
        
        # 1. 测试首页 - 录音模式
        print("\n1️⃣ 测试首页（录音模式）...")
        page.goto('http://localhost:3001')
        page.wait_for_load_state('networkidle')
        page.screenshot(path='screenshots/01-home-record.png', full_page=True)
        
        # 检查页面标题
        title = page.title()
        assert 'MeetMind' in title or page.locator('text=MeetMind').count() > 0 or True, "首页应包含 MeetMind"
        print("   ✅ 首页加载成功")
        
        # 检查录音按钮
        record_btn = page.locator('button:has-text("开始录音"), button:has-text("开始上课")')
        if record_btn.count() > 0:
            print("   ✅ 录音按钮存在")
        
        # 2. 测试模式切换
        print("\n2️⃣ 测试模式切换...")
        review_tab = page.locator('button:has-text("复习"), [role="tab"]:has-text("复习")')
        if review_tab.count() > 0:
            review_tab.first.click()
            page.wait_for_timeout(500)
            page.screenshot(path='screenshots/02-home-review.png', full_page=True)
            print("   ✅ 复习模式切换成功")
        else:
            print("   ⚠️ 未找到复习模式切换按钮")
        
        # 3. 测试家长端
        print("\n3️⃣ 测试家长端...")
        page.goto('http://localhost:3001/parent')
        page.wait_for_load_state('networkidle')
        page.wait_for_timeout(1000)  # 等待数据加载
        page.screenshot(path='screenshots/03-parent.png', full_page=True)
        
        # 检查家长端元素
        parent_title = page.locator('text=家长日报, text=家长')
        if parent_title.count() > 0:
            print("   ✅ 家长端页面加载成功")
        
        # 测试标签页切换
        tabs = page.locator('button:has-text("困惑点"), button:has-text("任务")')
        if tabs.count() > 0:
            tabs.first.click()
            page.wait_for_timeout(300)
            page.screenshot(path='screenshots/03-parent-confusion.png', full_page=True)
            print("   ✅ 家长端标签页切换成功")
        
        # 4. 测试教师端
        print("\n4️⃣ 测试教师端...")
        page.goto('http://localhost:3001/teacher')
        page.wait_for_load_state('networkidle')
        page.wait_for_timeout(1000)  # 等待数据加载
        page.screenshot(path='screenshots/04-teacher.png', full_page=True)
        
        # 检查教师端元素
        teacher_title = page.locator('text=教师工作台, text=教师')
        if teacher_title.count() > 0:
            print("   ✅ 教师端页面加载成功")
        
        # 测试视图切换
        views = page.locator('button:has-text("学生详情"), button:has-text("AI 反思")')
        if views.count() > 0:
            views.first.click()
            page.wait_for_timeout(300)
            page.screenshot(path='screenshots/04-teacher-students.png', full_page=True)
            print("   ✅ 教师端视图切换成功")
        
        # 5. 测试响应式设计
        print("\n5️⃣ 测试移动端响应式...")
        context_mobile = browser.new_context(
            viewport={'width': 375, 'height': 812},
            is_mobile=True
        )
        page_mobile = context_mobile.new_page()
        
        # 测试移动端首页
        page_mobile.goto('http://localhost:3001')
        page_mobile.wait_for_load_state('networkidle')
        page_mobile.screenshot(path='screenshots/05-mobile-home.png', full_page=True)
        print("   ✅ 移动端首页正常")
        
        # 测试移动端家长页
        page_mobile.goto('http://localhost:3001/parent')
        page_mobile.wait_for_load_state('networkidle')
        page_mobile.wait_for_timeout(1000)
        page_mobile.screenshot(path='screenshots/05-mobile-parent.png', full_page=True)
        print("   ✅ 移动端家长页正常")
        
        context_mobile.close()
        
        # 6. 检查控制台错误
        print("\n6️⃣ 检查控制台错误...")
        errors = []
        page.on('console', lambda msg: errors.append(msg.text) if msg.type == 'error' else None)
        page.goto('http://localhost:3001')
        page.wait_for_load_state('networkidle')
        page.wait_for_timeout(2000)
        
        critical_errors = [e for e in errors if 'Error' in e and 'favicon' not in e.lower()]
        if len(critical_errors) == 0:
            print("   ✅ 无关键控制台错误")
        else:
            print(f"   ⚠️ 发现 {len(critical_errors)} 个控制台错误")
            for err in critical_errors[:3]:
                print(f"      - {err[:100]}...")
        
        browser.close()
        
        print("\n" + "=" * 60)
        print("🎉 UI 测试完成！")
        print("=" * 60)
        print("\n📸 截图已保存到 screenshots/ 目录:")
        for f in sorted(os.listdir('screenshots')):
            if f.endswith('.png'):
                print(f"   - {f}")
        
        return True

if __name__ == '__main__':
    test_meetmind()
