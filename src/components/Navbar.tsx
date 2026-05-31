'use client';

import Link from "next/link";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { Github, Sun, Moon, FlaskConical } from "lucide-react";
import { useState, MouseEvent } from "react";
import { useTheme } from "next-themes";
import DeveloperPanel from "./DeveloperPanel";

export function Navbar() {
  const router = useRouter();
  const [showDevPanel, setShowDevPanel] = useState(false);
  const { theme, setTheme, resolvedTheme } = useTheme();
  const currentTheme = resolvedTheme ?? theme ?? "light";

  const toggleTheme = (event: MouseEvent<HTMLButtonElement>) => {
    const isDark = currentTheme === 'dark';
    const newTheme = isDark ? 'light' : 'dark';

    // Check if View Transitions API is supported
    if (!document.startViewTransition) {
      setTheme(newTheme);
      return;
    }

    const x = event.clientX;
    const y = event.clientY;
    const endRadius = Math.hypot(
      Math.max(x, innerWidth - x),
      Math.max(y, innerHeight - y)
    );

    const transition = document.startViewTransition(() => {
      setTheme(newTheme);
    });

    transition.ready.then(() => {
      const clipPath = [
        `circle(0px at ${x}px ${y}px)`,
        `circle(${endRadius}px at ${x}px ${y}px)`,
      ];

      document.documentElement.animate(
        {
          clipPath: clipPath,
        },
        {
          duration: 500,
          easing: "ease-in",
          pseudoElement: "::view-transition-new(root)",
        }
      );
    });
  };

  return (
    <>
      <nav className="h-16 bg-white/80 dark:bg-slate-900/80 backdrop-blur-md border-b border-sky-100 dark:border-slate-800 z-50 px-4 md:px-8 flex items-center justify-between transition-colors duration-300">
        <Link href="/" className="flex items-center gap-2 group">
          <Image src="/images/cherry-logo.svg" alt="Logo" width={40} height={40} className="h-10 w-auto transition-transform" />
        </Link>
        
        <div className="flex items-center gap-2">
          <button
            onClick={() => router.push('/api-test')}
            className="p-2 text-slate-400 dark:text-slate-500 hover:text-violet-500 dark:hover:text-violet-400 hover:bg-violet-50 dark:hover:bg-violet-900/20 rounded-full transition-all duration-300 cursor-pointer"
            title="API 源测试"
          >
            <FlaskConical className="w-5 h-5" />
          </button>

          <a 
            href="https://github.com/zjy8963/coco-downloader" 
            target="_blank" 
            rel="noopener noreferrer"
            className="p-2 text-slate-400 dark:text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-full transition-all duration-300 cursor-pointer"
          >
            <Github className="w-5 h-5" />
          </a>

          <button
            onClick={toggleTheme}
            className="p-2 text-slate-400 dark:text-slate-500 hover:text-sky-500 dark:hover:text-sky-400 hover:bg-sky-50 dark:hover:bg-slate-800 rounded-full transition-all duration-300 cursor-pointer"
            aria-label="Toggle theme"
          >
            {currentTheme === 'dark' ? (
              <Moon className="w-5 h-5" />
            ) : (
              <Sun className="w-5 h-5" />
            )}
          </button>
        </div>
      </nav>

      <DeveloperPanel open={showDevPanel} onClose={() => setShowDevPanel(false)} />
    </>
  );
}
