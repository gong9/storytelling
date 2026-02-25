export const metadata = {
  title: '评书工坊',
  description: 'AI 评书改编 + TTS 语音合成',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh">
      <body>{children}</body>
    </html>
  );
}
