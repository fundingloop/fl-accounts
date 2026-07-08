import "./globals.css";

export const metadata = {
  title: "Accounts - Funding Loop",
  description: "Funding Loop - Nepal accounts and cashflow",
  icons: { icon: "https://fundingloop.com.au/wp-content/uploads/2025/05/Funding-Loop-Favicon.png" },
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;500;600;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
