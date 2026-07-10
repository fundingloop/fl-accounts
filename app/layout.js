import { Poppins } from "next/font/google";
import "./globals.css";
import Providers from "@/components/Providers";

const poppins = Poppins({ subsets: ["latin"], weight: ["400", "500", "600", "700"], display: "swap" });

export const metadata = {
  title: "Accounts - Funding Loop",
  description: "Funding Loop - multi-entity accounts and cashflow",
  icons: { icon: "https://fundingloop.com.au/wp-content/uploads/2025/05/Funding-Loop-Favicon.png" },
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body className={poppins.className}>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
