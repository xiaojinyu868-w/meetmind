'use client';

import { useState } from 'react';
import Link from 'next/link';

interface FAQItem {
  question: string;
  answer: string;
}

interface HelpSection {
  title: string;
  items: FAQItem[];
}

const HELP_SECTIONS: HelpSection[] = [
  {
    title: '认识 MeetMind',
    items: [
      {
        question: 'MeetMind 是什么？',
        answer: 'MeetMind 是一个以学习者长期上下文为中心的 AI 学习产品。它的核心理念是「先收，再懂，再教」——你像发微信一样把学习现场的一切发给 MeetMind，它先收下，后台慢慢理解，理解成熟后自然长出回声、复习、AI 家教。\n\n当前聚焦课堂场景：录一节课 → MeetMind 帮你听懂这节课 → 生成一张让你忍不住分享到班级群的回声卡。'
      },
      {
        question: 'MeetMind 和录音转写工具有什么区别？',
        answer: '录音转写只是第一步。MeetMind 不只做转写，而是：\n\n1. 把课堂原件（录音、视频、文档、链接）先收进来，保留原件\n2. 后台自动理解：转录、提炼重点、发现困惑点\n3. 自然长出后续能力：回声卡、AI 家教、随堂检验、工作坊应用\n\n简单说，转写工具给你一堆文字，MeetMind 给你一个「听过你课的 AI 同桌」。'
      },
      {
        question: '我的数据安全吗？',
        answer: '你上传的音频、视频、文档等所有内容仅供你个人使用，不会被用于其他目的。我们高度重视用户隐私，详情请查看我们的隐私政策。'
      },
    ]
  },
  {
    title: '课堂',
    items: [
      {
        question: '如何录一节课？',
        answer: '1. 切换到「课堂」Tab\n2. 选择录音来源：\n   - 麦克风：线下课时录教室里的声音\n   - 电脑声音：在家听网课时录电脑播放的声音\n   - 两路都录：网课 + 自己提问都能录到（推荐）\n3. 点击「开始录一节课」\n4. 录音开始后，可以随时点开左侧活动条查看实时转录\n5. 点击停止按钮结束录音\n\n录音结束后，课程卡片会出现在课堂列表中。'
      },
      {
        question: '录课时能看到什么？',
        answer: '录课中 MeetMind 会实时展示：\n\n- 实时转录：老师说的每一句话都在跟读\n- 思维导图：每约 45 秒 AI 整理一次，把讲到的概念结构化呈现\n- AI 同桌：右侧面板进入「正在听课」模式，你有问题随时可以问\n\n这些都在后台自动完成，不需要你做任何操作。'
      },
      {
        question: '选择「电脑声音」后需要做什么？',
        answer: '选择「电脑声音」或「两路都录」后，点击开始录课时浏览器会弹出系统窗口，请勾选「分享系统音频」或「分享标签页音频」。\n\n这是浏览器安全策略要求的，MeetMind 无法绕过。如果没勾选音频分享，录音可能只有静音。'
      },
    ]
  },
  {
    title: '收集',
    items: [
      {
        question: '如何把内容发给 MeetMind？',
        answer: '在「收集」Tab 中，你可以通过底部输入栏：\n\n- 输入文字：记一句话、一个想法、一个困惑\n- 点击 + 号：上传文件（图片、文档、PDF、PPT、音频、视频）\n- 粘贴链接：B站视频、YouTube 视频、小宇宙播客、小红书、微信公众号文章等\n- 点击麦克风：开始录课\n\n所有内容先像消息一样进入收集流，不需要先分类或选功能。'
      },
      {
        question: '支持哪些链接导入？',
        answer: '支持导入以下平台的链接：\n\n- 视频平台：B站、YouTube\n- 播客平台：小宇宙\n- 图文平台：小红书、微信公众号\n- 其他网页文章\n\n粘贴链接后，MeetMind 会自动识别类型并导入内容。'
      },
      {
        question: '支持上传哪些文件格式？',
        answer: '支持上传的文件类型：\n\n- 音频：MP3、WAV、M4A、FLAC、OGG 等\n- 视频：MP4、MOV、AVI 等\n- 图片：JPG、PNG、GIF、WebP 等\n- 文档：PDF、PPT、Word 等\n\n单个音频文件建议不超过 2 小时，超过 10 分钟的长音频会自动切换到高精度异步转录模式。'
      },
      {
        question: '如何通过微信收集？',
        answer: 'MeetMind 支持微信服务号收集：\n\n1. 关注 MeetMind 微信服务号\n2. 首次使用需要绑定你的 MeetMind 账号（通过邮箱验证码或密码登录）\n3. 绑定后，像发微信一样把文字、语音、图片、链接直接发给服务号\n4. 内容自动进入你的收集流\n\n就像 flomo 一样随手记，但多了 AI 在后面帮你理解。'
      },
    ]
  },
  {
    title: '复习',
    items: [
      {
        question: '如何复习一节课？',
        answer: '在课堂列表中点击一节课的卡片，即可进入复习视图：\n\n- 波形回放：拖动波形跳转到任意位置\n- 时间轴：标记了知识点和困惑点\n- 随堂检验：播放到检验点时会弹出测验邀请（需要先在设置中开启）\n- AI 家教：随时就这节课的内容提问\n\n你也可以点击课程卡片上的「去复习」按钮直接进入。'
      },
      {
        question: '什么是随堂检验？',
        answer: '随堂检验是在复习录音时自动出现的互动测验：\n\n- AI 根据课堂内容自动生成检验点和题目\n- 播放到关键知识点时，底部会弹出邀请 Toast\n- 你可以选择参与或忽略，8 秒后自动消失\n- 答题后即时反馈对错和解析\n- 所有检验完成后可以查看学习报告\n\n需要在设置中开启「随堂检验」功能。'
      },
      {
        question: '什么是困惑点？',
        answer: '在录音中听到不确定的地方，你可以标记为困惑点：\n\n- 困惑点会在时间轴上高亮显示\n- 可以围绕困惑点向 AI 家教提问\n- 可以标记为已解决\n- 困惑点帮助你追踪还没完全理解的知识'
      },
    ]
  },
  {
    title: 'AI 家教',
    items: [
      {
        question: 'AI 家教和普通 AI 聊天有什么不同？',
        answer: 'MeetMind 的 AI 家教不是泛泛回答问题的聊天机器人，而是基于你的真实课堂上下文继续追问的私教：\n\n- 它「听过你的课」——基于转录内容和时间轴回答\n- 它「记得你的困惑」——围绕你标记的不理解的地方继续解释\n- 它「顺着你的上下文」——你选了哪些材料，它就围绕这些材料回答\n\n不是从题库开始，而是从你这节课的真实内容开始。'
      },
      {
        question: '如何使用 AI 家教？',
        answer: '有几种方式打开 AI 家教：\n\n1. 课堂页右侧面板：AI 同桌常驻，随时可以问\n2. 复习页中：就正在复习的这节课提问\n3. 收集页中：选中材料后向 AI 提问\n\n打开后，你可以：\n- 自由输入问题\n- 使用快捷意图按钮：先讲核心 / 换成例子 / 拆成步骤 / 提炼要点\n- 上传图片让 AI 结合图片回答'
      },
      {
        question: '什么是 AI 同桌？',
        answer: 'AI 同桌是课堂页右侧常驻的 AI 面板，它不是空白聊天框等你发话，而是「进来就看到它已经做了点什么」：\n\n- 课前：提醒你这节课的相关信息\n- 录课中：进入「正在听课」模式，偶尔冒出预知气泡（AI 基于转录预判接下来可能要讲什么）\n- 课后：轻声提示这节课有什么值得注意的\n\n它的消息是「放下」的，不是「弹出」的。不会自动滚到新消息——你转身时自己看到。'
      },
    ]
  },
  {
    title: '回声',
    items: [
      {
        question: '什么是回声？',
        answer: '回声是 MeetMind 自动从你的学习内容中提炼的知识反馈。它不是摘要，不是待办清单，不是每日报告。\n\n回声的特点：\n- 安静：不通知、不弹窗、不催促\n- 小：一条回声，一个发现，三句话\n- 有根：每句话都能指回你的真实原件\n- 不急：像发酵，时间到了自然出现\n\n回声会在收集流中自然出现，不需要你做任何操作。'
      },
      {
        question: '回声卡是什么？如何分享？',
        answer: '课堂回声卡是回声的可分享形态——一张精心设计的图片卡：\n\n- 包含课程名、日期、核心概念、老师金句、一句话总结\n- 点击回声卡片上的「分享」按钮即可生成\n- 长按图片可以保存到手机\n- 适合分享到班级群，让同学也看到这节课的核心\n\n增长单元不是「一个用户」，是「一个班级」。'
      },
    ]
  },
  {
    title: '工作坊',
    items: [
      {
        question: '工作坊有哪些应用？',
        answer: '工作坊是 MeetMind 的 AI 应用矩阵，每节课可以生成 6 种学习内容：\n\n- 课堂播客：把课堂内容转成双人对话播客，可收听\n- 闪卡训练：围绕重点生成闪卡，支持翻面和掌握度打分\n- 测验工坊：自动生成可作答测验，即时反馈\n- 思维导图：把课堂内容结构化为可交互导图\n- 信息图工坊：AI 生成可视化图片，支持信息图、知识卡片、流程图等 8 种场景\n- 学习报告：基于随堂检验答题数据的掌握度分析\n\n在复习页中点击「工作坊」即可打开应用矩阵。'
      },
      {
        question: '如何使用工作坊应用？',
        answer: '1. 进入一节课的复习视图\n2. 点击「工作坊」按钮打开应用矩阵\n3. 选择你想生成的应用（如思维导图）\n4. AI 会基于这节课的转录内容自动生成\n5. 生成完成后可以在独立窗口中查看和交互\n\n每个应用都可以重复生成，支持选择不同的 AI 模型。'
      },
    ]
  },
  {
    title: 'AI 搜索',
    items: [
      {
        question: '如何搜索我的学习内容？',
        answer: '在侧边栏点击「搜索笔记」即可打开 AI 搜索面板：\n\n- 支持跨所有笔记内容搜索\n- 搜索结果按内容类型分类展示（文字、录音、视频、图片、链接、文档）\n- 每种类型有独立图标和配色\n- 点击搜索结果可以跳转到对应内容\n\nAI 搜索不只是关键词匹配，还能理解你的搜索意图。'
      },
    ]
  },
  {
    title: '账户与设置',
    items: [
      {
        question: '如何修改个人信息？',
        answer: '点击侧边栏底部的头像，进入「设置」页面，可以修改昵称、头像等信息。'
      },
      {
        question: '忘记密码怎么办？',
        answer: '在登录页面点击「忘记密码」，通过注册时的邮箱验证身份后即可重置密码。'
      },
      {
        question: '如何开启/关闭随堂检验？',
        answer: '进入「设置」页面，找到「随堂检验」开关，开启或关闭即可。开启后，复习录音时会自动出现互动测验。'
      },
      {
        question: '如何反馈问题或建议？',
        answer: '我们非常欢迎你的反馈！可以通过以下方式：\n\n- 点击「意见反馈」页面提交\n- 发送邮件至 originedu@meetmind.online'
      },
    ]
  },
  {
    title: '常见问题',
    items: [
      {
        question: '转录准确率如何？',
        answer: '在清晰的普通话录音下准确率可达 95% 以上。以下因素会影响准确率：\n\n- 录音质量：建议使用清晰的录音设备\n- 背景噪音：尽量在安静环境录音\n- 口音和方言：普通话标准时效果最好\n- 专业术语：课前预习材料标题会自动注入 ASR 热词，提升专业词汇识别率\n\n如果转录有误，你可以在转录文本中直接点击编辑修正。'
      },
      {
        question: '处理速度慢怎么办？',
        answer: '处理速度取决于内容时长和服务器负载：\n\n- 短音频（10 分钟内）：通常 1-3 分钟完成转录\n- 长音频（10 分钟以上）：自动切换异步模式，通常 3-10 分钟\n- 回声生成：不固定节奏，AI 真正有话可说时才出现\n\n如果等待时间过长，可以刷新页面或稍后再试。后台处理不会丢失数据。'
      },
      {
        question: '支持哪些平台？',
        answer: 'MeetMind 目前支持：\n\n- Web 端：在浏览器中访问（推荐 Chrome）\n- 微信服务号：通过微信轻收集入口\n- 移动端：支持手机浏览器访问，有专门的移动端适配\n\n桌面端和移动端功能基本一致，移动端有专门的底部面板和手势交互。'
      },
    ]
  },
];

export default function HelpPage() {
  const [expandedSection, setExpandedSection] = useState<number>(0);
  const [expandedItems, setExpandedItems] = useState<Set<string>>(new Set(['0-0']));

  const toggleItem = (sectionIndex: number, itemIndex: number) => {
    const key = `${sectionIndex}-${itemIndex}`;
    const newExpanded = new Set(expandedItems);
    if (newExpanded.has(key)) {
      newExpanded.delete(key);
    } else {
      newExpanded.add(key);
    }
    setExpandedItems(newExpanded);
  };

  return (
    <div className="min-h-screen bg-canvas">
      {/* 顶部导航 */}
      <header className="sticky top-0 z-10 border-b border-divider bg-white/80 backdrop-blur-sm">
        <div className="mx-auto flex h-14 max-w-3xl items-center justify-between px-4">
          <Link href="/app" className="flex items-center gap-2 text-ink-secondary transition-colors hover:text-ink">
            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
            </svg>
            <span className="text-[13px]">返回</span>
          </Link>
          <h1 className="text-[15px] font-semibold text-ink">帮助中心</h1>
          <div className="w-14" />
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-4 py-8">
        {/* 欢迎区域 */}
        <div className="mb-10 text-center">
          <h2 className="text-[24px] font-semibold tracking-[-0.02em] text-ink">
            有什么可以帮助你的？
          </h2>
          <p className="mt-2 text-[14px] text-ink-secondary">
            先收，再懂，再教
          </p>
        </div>

        {/* 快速入口 */}
        <div className="mb-10 flex flex-wrap gap-2">
          {HELP_SECTIONS.map((section, index) => (
            <button
              key={index}
              onClick={() => {
                setExpandedSection(index);
                document.getElementById(`section-${index}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
              }}
              className={`rounded-full border px-4 py-2 text-[13px] font-medium transition-colors ${
                expandedSection === index
                  ? 'border-ink bg-ink text-white'
                  : 'border-divider bg-white text-ink-secondary hover:border-ink/30 hover:text-ink'
              }`}
            >
              {section.title}
            </button>
          ))}
        </div>

        {/* FAQ 列表 */}
        <div className="space-y-8">
          {HELP_SECTIONS.map((section, sIndex) => (
            <div key={sIndex} id={`section-${sIndex}`} className="scroll-mt-20">
              <h3 className="mb-4 text-[15px] font-semibold text-ink">
                {section.title}
              </h3>
              <div className="space-y-2">
                {section.items.map((item, iIndex) => {
                  const isExpanded = expandedItems.has(`${sIndex}-${iIndex}`);
                  return (
                    <div
                      key={iIndex}
                      className="overflow-hidden rounded-xl border border-divider bg-card"
                    >
                      <button
                        onClick={() => toggleItem(sIndex, iIndex)}
                        className="flex w-full items-center justify-between px-5 py-4 text-left transition-colors hover:bg-canvas/50"
                      >
                        <span className="pr-4 text-[14px] font-medium text-ink">{item.question}</span>
                        <svg
                          className={`h-4 w-4 flex-shrink-0 text-ink-muted transition-transform ${
                            isExpanded ? 'rotate-180' : ''
                          }`}
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 9l-7 7-7-7" />
                        </svg>
                      </button>
                      {isExpanded && (
                        <div className="px-5 pb-4">
                          <div className="border-t border-divider pt-3">
                            <p className="whitespace-pre-line text-[13.5px] leading-[1.8] text-ink-secondary">
                              {item.answer}
                            </p>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>

        {/* 联系我们 */}
        <div className="mt-12 rounded-2xl bg-ink p-6 text-white">
          <div className="flex flex-col items-center justify-between gap-4 sm:flex-row">
            <div>
              <h3 className="text-[16px] font-semibold">没有找到答案？</h3>
              <p className="mt-1 text-[13px] text-white/70">我们的团队随时为你提供帮助</p>
            </div>
            <div className="flex gap-3">
              <Link
                href="/feedback"
                className="inline-flex items-center gap-2 rounded-xl bg-white px-5 py-2.5 text-[13px] font-medium text-ink transition-colors hover:bg-canvas"
              >
                提交反馈
              </Link>
              <a
                href="mailto:originedu@meetmind.online"
                className="inline-flex items-center gap-2 rounded-xl bg-white/15 px-5 py-2.5 text-[13px] font-medium text-white transition-colors hover:bg-white/25"
              >
                发送邮件
              </a>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
