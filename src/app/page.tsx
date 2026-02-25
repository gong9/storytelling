export default function Home() {
  return (
    <main style={{ maxWidth: 800, margin: '80px auto', fontFamily: 'system-ui', padding: '0 20px' }}>
      <h1 style={{ fontSize: 32, marginBottom: 8 }}>📖 评书工坊</h1>
      <p style={{ color: '#666', marginBottom: 40 }}>AI 评书改编 + TTS 语音合成</p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 32 }}>
        <section>
          <h2 style={{ fontSize: 20, marginBottom: 12 }}>1. 评书改编</h2>
          <code style={{ display: 'block', background: '#f5f5f5', padding: 16, borderRadius: 8, fontSize: 14 }}>
            {`curl -X POST -F "file=@你的书.pdf" http://localhost:3100/api/read`}
          </code>
          <p style={{ color: '#888', fontSize: 14, marginTop: 8 }}>
            上传 PDF/TXT，自动改编为评书风格文本。输出到 out/deep/ 目录。
          </p>
        </section>

        <section>
          <h2 style={{ fontSize: 20, marginBottom: 12 }}>2. TTS 语音合成</h2>
          <code style={{ display: 'block', background: '#f5f5f5', padding: 16, borderRadius: 8, fontSize: 14 }}>
            {`curl -X POST -H "Content-Type: application/json" \\
  -d '{"filePath":"out/deep/xxx.md","speed":1.3}' \\
  http://localhost:3100/api/tts`}
          </code>
          <p style={{ color: '#888', fontSize: 14, marginTop: 8 }}>
            读取改编后的文本，按回目拆分，逐回生成 MP3 音频。输出到 out/audio/ 目录。
          </p>
        </section>

        <section>
          <h2 style={{ fontSize: 20, marginBottom: 12 }}>接口文档</h2>
          <ul style={{ listStyle: 'none', padding: 0 }}>
            <li><a href="/api/read" style={{ color: '#0070f3' }}>GET /api/read</a> — 改编接口说明</li>
            <li><a href="/api/tts" style={{ color: '#0070f3' }}>GET /api/tts</a> — TTS 接口说明</li>
          </ul>
        </section>
      </div>
    </main>
  );
}
