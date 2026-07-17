# ASR Real-Audio Fixtures

本目录保存可重复的短音频质量门，只服务于 `make eval-asr-real`：

- `demo-en-clean-25s.wav`：从 `public/demo-audio.mp3` 截取前 25 秒，16kHz / mono / PCM16。
- `demo-en-pink-{20,10,5}db-25s.wav`：同一段语音叠加固定 seed 的粉红噪声，语音与噪声分别响度归一后按目标 SNR 混合。
- 四条音频共用同一人工参考文本，因此 CER 的变化可归因于噪声而非内容差异。

生成资产使用 ffmpeg，输出必须保持 16kHz / mono；不要手工编辑二进制文件。数据集元数据位于 `datasets/real-noise-demo.jsonl`。

当前只是英语课堂的确定性质量门，不代表真实教室全量分布。加入新的中文、中英混合、远场、风扇或键盘 fixture 时，必须同时提供人工 reference、`audioDurationMs` 与可解释的噪声标签。
