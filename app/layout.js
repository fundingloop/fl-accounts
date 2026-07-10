import { Poppins } from "next/font/google";
import "./globals.css";

const poppins = Poppins({ subsets: ["latin"], weight: ["400", "500", "600", "700"], display: "swap" });

export const metadata = {
  title: "Accounts - Funding Loop",
  description: "Funding Loop - Nepal accounts and cashflow",
  icons: { icon: "https://fundingloop.com.au/wp-content/uploads/2025/05/Funding-Loop-Favicon.png" },
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body className={poppins.className}>{children}</body>
    </html>
  );
}
