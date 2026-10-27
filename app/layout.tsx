import type { Metadata } from "next";
import { Source_Code_Pro } from "next/font/google";
import { Suspense } from "react";
import { NavLine, SiteNav } from "@/components/site-nav";
import "./globals.css";

const sourceCodePro = Source_Code_Pro({
  variable: "--font-source-code-pro",
  weight: "400",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Gashi's Poker",
  description: "A poker math trainer: learn, drill, play bots or friends, and test ideas in the lab.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${sourceCodePro.variable} h-full`}>
      <body className="doc flex min-h-full flex-col">
        <header className="sheet site-head">
          <Suspense fallback={<NavLine pathname={null} />}>
            <SiteNav />
          </Suspense>
        </header>
        {children}
      </body>
    </html>
  );
}
