#!/usr/bin/env ts-node
/**
 * 国际化辅助脚本
 * 用于扫描和替换组件中的中文文本
 */

import * as fs from 'fs';
import * as path from 'path';

// 需要处理的组件列表
const componentsToProcess = [
  'src/components/Recorder.tsx',
  'src/components/WaveformPlayer.tsx',
  'src/components/AudioUploader.tsx',
  'src/components/AIChat.tsx',
  'src/components/AITutor.tsx',
  'src/components/ActionList.tsx',
  'src/components/ActionSidebar.tsx',
  'src/components/NotesPanel.tsx',
  'src/components/HighlightsPanel.tsx',
  'src/components/SummaryPanel.tsx',
  'src/components/AppLoading.tsx',
  'src/components/OnboardingGuide.tsx',
];

// 常见的翻译映射
const commonTranslations: Record<string, string> = {
  '加载中': 'common.loading',
  '保存': 'common.save',
  '取消': 'common.cancel',
  '删除': 'common.delete',
  '编辑': 'common.edit',
  '创建': 'common.create',
  '关闭': 'common.close',
  '返回': 'common.back',
  '下一步': 'common.next',
  '确认': 'common.confirm',
  '发送': 'common.send',
  '搜索': 'common.search',
  '更多': 'common.more',
  '收起': 'common.less',
  '展开': 'common.expand',
  '上传': 'common.upload',
  '下载': 'common.download',
  '复制': 'common.copy',
  '分享': 'common.share',
  '成功': 'common.success',
  '错误': 'common.error',
  '警告': 'common.warning',
  '提示': 'common.info',
  '确定': 'common.ok',
  '重试': 'common.retry',
};

function scanFile(filePath: string) {
  const content = fs.readFileSync(filePath, 'utf-8');
  const chineseRegex = /[\u4e00-\u9fa5]{2,}/g;
  const matches = content.match(chineseRegex) || [];
  return [...new Set(matches)];
}

function main() {
  console.log('Scanning components for Chinese text...\n');
  
  for (const component of componentsToProcess) {
    const fullPath = path.join(process.cwd(), component);
    if (!fs.existsSync(fullPath)) {
      console.log(`⚠️  File not found: ${component}`);
      continue;
    }
    
    const chineseTexts = scanFile(fullPath);
    if (chineseTexts.length > 0) {
      console.log(`\n📄 ${component}:`);
      chineseTexts.forEach(text => {
        console.log(`   - "${text}"`);
      });
    }
  }
}

main();
