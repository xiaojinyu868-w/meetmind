'use client';

/**
 * 协议弹窗组件 - 延迟加载
 * 包含用户服务协议和隐私政策的完整文本，
 * 从登录页提取出来以减少首屏 JS bundle 大小。
 */

type AgreementType = 'terms' | 'privacy' | null;

interface AgreementSection {
  title: string;
  content: (string | { subtitle?: string; items?: string[]; text?: string })[];
}

// 用户服务协议
const TERMS_SECTIONS: AgreementSection[] = [
  {
    title: '引言',
    content: [
      { text: '欢迎使用 MeetMind 智能学习平台（以下简称"MeetMind"或"本平台"），包括 MeetMind 网站（meetmind.online）、移动应用程序及其提供的所有功能和服务（统称"服务"）。' },
      { text: '服务提供者：MeetMind 团队（以下简称"我们"）' },
      { text: '联系方式：originedu@meetmind.online' },
      { text: '请您在使用本服务前仔细阅读并充分理解本协议的全部内容。当您注册、登录、使用本服务时，即表示您已阅读、理解并同意接受本协议的约束。如您不同意本协议的任何内容，请立即停止使用本服务。' },
    ]
  },
  {
    title: '一、服务说明',
    content: [
      { text: 'MeetMind 是清华北大联合团队打造的 AI 学习助手，为每个孩子配备一位"听过课、记得住、讲得清"的智能同桌。核心功能包括：' },
      { items: [
        '语音转文字：将音频内容转换为文字记录',
        'AI 对话：基于学习内容的智能问答和辅导',
        '智能摘要：自动生成学习内容的结构化摘要',
        '话题提取：识别和标记学习材料中的重点内容',
      ]},
      { text: '我们保留随时修改、更新、中断或终止部分或全部服务的权利，恕不另行通知。对于服务的变更，我们将在合理范围内通知用户。' },
    ]
  },
  {
    title: '二、账户注册与使用',
    content: [
      { subtitle: '1. 注册条件' },
      { text: 'MeetMind 是一款教育辅助产品，欢迎各年龄段的学习者使用：' },
      { items: [
        '14周岁以上的用户可以自行注册和使用本服务',
        '14周岁以下的用户需在监护人的同意和指导下使用，并由监护人代为注册账户',
        '您（或您的监护人）承诺提供的注册信息真实、准确、完整',
      ]},
      { subtitle: '2. 账户安全' },
      { items: [
        '您有责任妥善保管您的账户凭证（包括密码、验证码等）',
        '因您个人原因导致的账户泄露、被盗或未经授权使用，由您自行承担相应责任',
        '如发现账户存在安全问题，请立即联系我们',
      ]},
      { subtitle: '3. 账户限制' },
      { text: '我们有权对存在异常行为、违规使用或安全风险的账户采取限制、暂停或终止措施。' },
    ]
  },
  {
    title: '三、用户行为规范',
    content: [
      { text: '您在使用本服务时承诺遵守以下规范：' },
      { items: [
        '遵守中华人民共和国相关法律法规及本协议的全部条款',
        '不利用本服务从事任何违法、违规或侵害他人权益的活动',
        '不上传、传播、存储任何违法、侵权、淫秽、暴力、恐怖、诈骗或其他有害内容',
        '不干扰、破坏、攻击本服务的正常运行或安全防护措施',
        '不进行恶意刷取 API 调用、滥用服务资源或其他损害服务公平性的行为',
        '不利用本服务生成虚假、误导性或有害的内容',
        '不转售、转让或以任何方式商业化利用本服务（除非获得我们的书面授权）',
      ]},
      { text: '如您违反上述规范，我们有权立即终止您的服务使用权，并保留追究法律责任的权利。' },
    ]
  },
  {
    title: '四、知识产权',
    content: [
      { subtitle: '1. 平台权利' },
      { text: '本服务的所有内容，包括但不限于软件、代码、界面设计、商标、标识、文字、图片及其组合，均受中华人民共和国知识产权法律保护，相关权利归我们或相应权利人所有。' },
      { subtitle: '2. 用户内容' },
      { items: [
        '您上传的内容（包括音频、文本等），您保留相应的知识产权',
        '您授予我们为提供服务所必需的、非独占的、可转许可的使用权',
        '该授权仅用于向您提供服务，不会用于其他商业目的',
      ]},
      { subtitle: '3. AI 生成内容' },
      { items: [
        'AI 生成的内容（包括摘要、回答、建议等）由人工智能算法自动生成，仅供参考',
        '我们对 AI 生成内容的准确性、完整性不作任何明示或暗示的保证',
        '您对使用 AI 生成内容所做的决策和行为承担全部责任',
        '如 AI 生成内容存在错误或不当，请及时向我们反馈，我们将不断优化改进',
      ]},
    ]
  },
  {
    title: '五、内容安全与合规',
    content: [
      { text: '我们高度重视内容安全，依据《生成式人工智能服务管理暂行办法》等相关法规，采取以下措施：' },
      { items: [
        '建立内容审核机制，防止生成违法违规、虚假有害内容',
        '对用户上传内容进行安全检测，发现违规内容将及时处理',
        '持续优化 AI 模型，提高生成内容的准确性和安全性',
        '设立用户举报渠道，及时响应并处理违规内容投诉',
      ]},
      { text: '如您发现平台存在违法违规内容，请通过"联系我们"部分提供的方式举报，我们将在 24 小时内处理。' },
    ]
  },
  {
    title: '六、免责声明',
    content: [
      { text: '在法律允许的最大范围内：' },
      { items: [
        '本服务按"现状"和"可用"基础提供，我们不对服务的持续性、及时性、安全性或无错误性作出任何明示或暗示的保证',
        'AI 生成的内容可能存在不准确、不完整或过时的情况，请您自行判断和核实',
        '因网络状况、通讯线路、第三方服务故障或不可抗力导致的服务中断或数据损失，我们不承担责任',
        '您因使用或无法使用本服务而产生的任何直接、间接、附带、特殊或惩罚性损失，我们不承担责任',
        '对于第三方服务（如支付、云存储等）的使用，请参阅相关第三方的服务条款',
      ]},
    ]
  },
  {
    title: '七、服务费用',
    content: [
      { text: '目前 MeetMind 的基础功能免费提供。我们可能在未来推出付费功能或订阅服务，届时将提前通知并明确收费标准。' },
      { text: '为保障服务的公平使用，我们对 API 调用实施合理的频率限制。如您的使用超出正常范围，可能会受到临时限制。' },
    ]
  },
  {
    title: '八、协议变更',
    content: [
      { text: '我们保留随时修改本协议的权利。协议变更后，我们将在平台显著位置发布更新通知。如您在协议变更后继续使用本服务，即表示您接受修改后的协议。' },
      { text: '对于重大变更，我们将通过应用内通知、邮件或其他合理方式提前告知您。' },
    ]
  },
  {
    title: '九、法律适用与争议解决',
    content: [
      { items: [
        '本协议的订立、效力、解释、履行及争议解决均适用中华人民共和国法律（不包括冲突法规则）',
        '如发生争议，双方应首先友好协商解决',
        '协商不成的，任何一方可向我们所在地有管辖权的人民法院提起诉讼',
      ]},
    ]
  },
  {
    title: '十、联系我们',
    content: [
      { text: '如您对本协议有任何疑问、建议或投诉，请通过以下方式联系我们：' },
      { items: [
        '应用内反馈功能',
        '邮箱：originedu@meetmind.online',
      ]},
      { text: '我们将在收到您的请求后尽快回复。' },
    ]
  },
];

// 隐私政策
const PRIVACY_SECTIONS: AgreementSection[] = [
  {
    title: '引言',
    content: [
      { text: '欢迎使用 MeetMind 智能学习平台（以下简称"MeetMind"或"本平台"）。我们深知个人信息对您的重要性，并将竭力保护您的隐私安全。' },
      { text: '个人信息处理者：MeetMind 团队' },
      { text: '联系方式：originedu@meetmind.online' },
      { text: '本隐私政策说明我们如何收集、使用、存储、共享和保护您的个人信息，以及您享有的相关权利。请在使用我们的服务前仔细阅读本政策。' },
      { text: '使用本服务即表示您同意本隐私政策。如您不同意，请停止使用我们的服务。' },
    ]
  },
  {
    title: '一、我们收集的信息',
    content: [
      { subtitle: '1. 您主动提供的信息' },
      { items: [
        '账户信息：当您注册账户时，我们会收集您的邮箱地址、手机号码（用于身份验证和登录）',
        '用户内容：您上传、创建或通过服务生成的内容，包括音频文件、文本、学习笔记、个人资料（如昵称、头像）等',
        '通讯信息：当您通过反馈、客服或其他渠道联系我们时，我们会收集您提供的信息和通讯内容',
      ]},
      { subtitle: '2. 自动收集的信息' },
      { items: [
        '设备信息：设备型号、操作系统版本、浏览器类型、唯一设备标识符、屏幕分辨率',
        '日志信息：IP 地址、访问时间、浏览页面、点击记录、功能使用情况、错误日志',
        '位置信息：我们可能通过 IP 地址推断您的大致地理位置（如国家、城市），用于安全保护和服务优化',
        'Cookies 和类似技术：用于维持登录状态、记住您的偏好设置、分析服务使用情况',
      ]},
      { subtitle: '3. 第三方来源的信息' },
      { text: '如您选择使用第三方账户（如微信）登录，我们可能会从该第三方获取您授权共享的信息，如用户名、头像等公开资料。' },
    ]
  },
  {
    title: '二、我们如何使用您的信息',
    content: [
      { text: '我们收集的信息用于以下目的：' },
      { items: [
        '提供、运营和维护我们的服务及其核心功能',
        '验证您的身份，保障账户和服务安全',
        '处理您的请求，提供客户支持和技术帮助',
        '发送服务通知、验证码、重要更新和安全提醒',
        '分析和改进服务质量、用户体验和功能设计',
        '检测、预防和处理欺诈、滥用或安全威胁',
        '遵守适用的法律法规和监管要求',
        '执行我们的服务条款和保护我们的合法权益',
      ]},
      { subtitle: 'AI 自动化决策说明' },
      { text: '本平台使用人工智能技术处理您上传的内容，包括语音转文字、智能摘要生成、话题提取等。这些功能通过自动化方式处理您的信息，处理结果仅供您参考使用。您可以随时联系我们对自动化处理结果提出异议或要求人工复核。' },
      { text: '我们郑重承诺：不会将您的个人信息出售给任何第三方。' },
    ]
  },
  {
    title: '三、信息共享与第三方',
    content: [
      { text: '我们仅在以下情况下共享您的个人信息：' },
      { subtitle: '1. 经您同意' },
      { text: '在获得您明确同意后，我们可能会与第三方共享您的信息。' },
      { subtitle: '2. 服务提供商' },
      { text: '我们可能委托以下类型的第三方服务商协助我们运营（我们会要求其遵守严格的保密义务）：' },
      { items: [
        '云服务提供商：用于数据存储和计算（如腾讯云、阿里云）',
        'AI 服务提供商：用于语音识别、自然语言处理等功能',
        '数据分析服务：用于服务质量监控和改进',
        '支付服务提供商：处理付费功能的支付（如适用）',
      ]},
      { subtitle: '3. 法律要求' },
      { text: '当法律法规要求、司法机关或政府部门依法要求时，我们可能会披露您的信息。' },
      { subtitle: '4. 保护权益' },
      { text: '为保护我们、用户或公众的权利、财产或安全，我们可能会共享必要的信息。' },
      { subtitle: '5. 企业交易' },
      { text: '如发生合并、收购、资产出售或类似交易，您的信息可能作为交易资产的一部分被转移。我们将确保接收方继续遵守本隐私政策或提供同等保护。' },
    ]
  },
  {
    title: '四、信息存储与安全',
    content: [
      { subtitle: '1. 存储地点' },
      { text: '您的个人信息存储在位于中华人民共和国境内的服务器上。如需跨境传输，我们将依法履行相关手续并告知您。' },
      { subtitle: '2. 存储期限' },
      { text: '我们按照以下原则确定个人信息的存储期限：' },
      { items: [
        '账户信息：在您使用本服务期间持续保存，注销账户后 30 天内删除或匿名化处理',
        '学习内容：在您使用本服务期间持续保存，您可随时删除，注销账户后 30 天内删除',
        '日志信息：保存不超过 6 个月，用于安全审计和问题排查',
        '法律法规另有要求的，从其规定',
      ]},
      { subtitle: '3. 安全措施' },
      { text: '我们采用业界标准的安全技术和管理措施保护您的信息，包括但不限于：' },
      { items: [
        'HTTPS 加密传输',
        '数据加密存储',
        '访问权限控制',
        '安全审计和监控',
        '定期安全评估',
      ]},
      { text: '尽管我们采取了合理的安全措施，但请理解互联网传输不能保证100%安全。请妥善保管您的账户信息。' },
    ]
  },
  {
    title: '五、您的权利',
    content: [
      { text: '根据《中华人民共和国个人信息保护法》等相关法律，您享有以下权利：' },
      { items: [
        '知情权和决定权：了解我们如何处理您的个人信息，并决定是否同意',
        '查阅权：查看我们持有的您的个人信息',
        '更正权：要求我们更正不准确或不完整的个人信息',
        '删除权：在特定情况下要求我们删除您的个人信息',
        '撤回同意权：撤回您之前给予的同意（不影响撤回前的处理合法性）',
        '注销权：注销您的账户并要求删除相关数据',
        '投诉权：向个人信息保护监管部门投诉',
      ]},
      { text: '如需行使上述权利，请通过"联系我们"部分提供的方式与我们联系。我们将在核实您的身份后，在法定期限内响应您的请求。' },
    ]
  },
  {
    title: '六、未成年人及学生用户保护',
    content: [
      { text: 'MeetMind 是一款面向学习者的教育辅助产品，我们欢迎学生用户使用本服务。我们高度重视未成年人个人信息保护，并严格遵守《中华人民共和国未成年人保护法》《儿童个人信息网络保护规定》等相关法律法规。' },
      { subtitle: '1. 未成年人信息保护负责人' },
      { text: '我们设有专人负责未成年人个人信息保护工作。如有相关问题，请联系：originedu@meetmind.online（请在邮件主题标注"未成年人信息保护"）。' },
      { subtitle: '2. 未成年人使用须知' },
      { items: [
        '14周岁以下的未成年人（儿童），需在监护人的陪同和指导下使用本服务，并由监护人代为注册账户、签署相关协议',
        '14周岁以上的未成年人，可以自行注册和使用本服务，但建议在监护人知情的情况下使用',
        '监护人有权随时查阅、更正、删除未成年人的个人信息，或注销其账户',
      ]},
      { subtitle: '3. 我们收集的未成年人信息' },
      { text: '对于未成年人用户，我们仅收集提供教育服务所必需的最少信息，包括：' },
      { items: [
        '账户信息：邮箱或手机号（用于注册登录）',
        '学习内容：用户上传的学习资料和学习记录',
        '设备和日志信息：用于保障服务安全和优化体验',
      ]},
      { subtitle: '4. 未成年人信息的使用' },
      { items: [
        '我们仅将未成年人信息用于提供和改进教育服务',
        '不会将未成年人信息用于商业营销或广告推送',
        '不会向任何第三方出售或出租未成年人的个人信息',
        '不会利用未成年人信息进行用户画像或行为分析（服务必需的除外）',
      ]},
      { subtitle: '5. 监护人权利' },
      { text: '作为未成年人的监护人，您依法享有以下权利：' },
      { items: [
        '查阅和复制未成年人的个人信息',
        '要求更正或补充不准确的信息',
        '要求删除未成年人的个人信息',
        '撤回对信息处理的同意',
        '注销未成年人的账户',
      ]},
      { text: '如需行使上述权利，请通过"联系我们"部分提供的方式与我们联系，我们将在核实监护关系后及时处理。' },
      { subtitle: '6. 特别说明' },
      { text: '如果我们发现在未获得监护人同意的情况下收集了14周岁以下儿童的个人信息，我们将采取措施尽快删除相关信息。如果您是监护人并发现您的孩子在未经同意的情况下向我们提供了个人信息，请立即联系我们。' },
    ]
  },
  {
    title: '七、政策更新',
    content: [
      { text: '我们可能会不时更新本隐私政策以反映法律、技术或业务的变化。更新后的政策将在本页面发布，并注明最后更新日期。' },
      { text: '对于重大变更，我们将通过应用内通知、邮件或其他显著方式提前通知您。继续使用本服务即表示您接受更新后的隐私政策。' },
    ]
  },
  {
    title: '八、联系我们',
    content: [
      { text: '如您对本隐私政策有任何疑问、意见或请求，请通过以下方式联系我们：' },
      { items: [
        '应用内反馈功能',
        '邮箱：originedu@meetmind.online',
      ]},
      { text: '我们将在收到您的请求后15个工作日内核实您的身份并予以回复。对于复杂请求，可能需要更长时间，届时我们会及时告知您。' },
      { text: '如您认为我们对您个人信息的处理违反了本政策或相关法律，您有权向个人信息保护主管部门投诉。' },
    ]
  },
];

export function AgreementModal({ 
  type, 
  onClose 
}: { 
  type: AgreementType; 
  onClose: () => void;
}) {
  if (!type) return null;
  
  const isTerms = type === 'terms';
  const title = isTerms ? 'MeetMind 用户服务协议' : 'MeetMind 隐私政策';
  const sections = isTerms ? TERMS_SECTIONS : PRIVACY_SECTIONS;
  const updateDate = '2026年1月28日';
  
  return (
    <div 
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div className="absolute inset-0 bg-black/50" />
      
      <div 
        className="relative w-full max-w-2xl max-h-[85vh] bg-white rounded-2xl shadow-2xl overflow-hidden animate-modal-in"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 z-10 flex items-center justify-between px-6 py-4 bg-[#1C1B19] text-white">
          <div>
            <h2 className="text-lg font-semibold">{title}</h2>
            <p className="text-xs text-white/80 mt-0.5">生效日期：{updateDate}</p>
          </div>
          <button 
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-full bg-white/20 hover:bg-white/30 transition-colors"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        
        <div className="p-6 overflow-y-auto max-h-[calc(85vh-72px)]">
          <div className="space-y-6">
            {sections.map((section, sIdx) => (
              <div key={sIdx}>
                <h3 className="text-base font-semibold text-ink mb-3 pb-2 border-b border-divider-light">
                  {section.title}
                </h3>
                <div className="space-y-3">
                  {section.content.map((item, iIdx) => {
                    if (typeof item === 'string') {
                      return <p key={iIdx} className="text-sm text-ink-secondary leading-relaxed">{item}</p>;
                    }
                    if (item.subtitle) {
                      return <h4 key={iIdx} className="text-sm font-medium text-ink mt-4 mb-2">{item.subtitle}</h4>;
                    }
                    if (item.items) {
                      return (
                        <ul key={iIdx} className="space-y-1.5 ml-4">
                          {item.items.map((li, liIdx) => (
                            <li key={liIdx} className="text-sm text-ink-secondary leading-relaxed flex items-start gap-2">
                              <span className="text-vermilion/65 mt-1.5 flex-shrink-0">•</span>
                              <span>{li}</span>
                            </li>
                          ))}
                        </ul>
                      );
                    }
                    if (item.text) {
                      return <p key={iIdx} className="text-sm text-ink-secondary leading-relaxed">{item.text}</p>;
                    }
                    return null;
                  })}
                </div>
              </div>
            ))}
          </div>
          
          <div className="mt-8 pt-4 border-t border-divider-light">
            <p className="text-xs text-ink-muted text-center">
              使用 MeetMind 服务即表示您已阅读并同意本{isTerms ? '协议' : '政策'}
            </p>
          </div>
        </div>
      </div>
      
      <style jsx>{`
        @keyframes modal-in {
          from {
            opacity: 0;
            transform: scale(0.95) translateY(10px);
          }
          to {
            opacity: 1;
            transform: scale(1) translateY(0);
          }
        }
        .animate-modal-in {
          animation: modal-in 0.2s ease-out;
        }
      `}</style>
    </div>
  );
}

export default AgreementModal;
