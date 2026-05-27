import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "น้อง PK — คลินิกพัฒนาการ รพ.ภูเขียวเฉลิมพระเกียรติ",
  description: "LINE Bot ช่วยตอบคำถามคลินิกพัฒนาการ",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="th">
      <body>{children}</body>
    </html>
  );
}
