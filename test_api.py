import requests
import json

# 测试 generate-topics API
url = "http://localhost:3001/api/generate-topics"

# 模拟上传后的转录数据（使用 demo 数据格式）
demo_transcript = [
    {"id": "s1", "text": "今天我们来学习二次函数的图像", "startMs": 0, "endMs": 15000},
    {"id": "s2", "text": "二次函数的一般形式是 y = ax² + bx + c", "startMs": 15000, "endMs": 35000},
    {"id": "s3", "text": "其中 a 不等于 0，a 的正负决定了抛物线的开口方向", "startMs": 35000, "endMs": 60000},
    {"id": "s4", "text": "当 a 大于 0 时，抛物线开口向上", "startMs": 60000, "endMs": 85000},
    {"id": "s5", "text": "当 a 小于 0 时，抛物线开口向下", "startMs": 85000, "endMs": 110000},
]

payload = {
    "sessionId": "test-session",
    "transcript": demo_transcript,
    "mode": "smart",
    "sessionInfo": {
        "subject": "数学",
        "topic": "二次函数"
    }
}

print("Testing generate-topics API with smart mode...")
print(f"Transcript length: {len(demo_transcript)}")

response = requests.post(url, json=payload)
print(f"Status: {response.status_code}")
print(f"Response: {json.dumps(response.json(), ensure_ascii=False, indent=2)}")
