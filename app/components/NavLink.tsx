"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export default function NavLink({
  href,
  children,
}: {
  href: string;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const isActive = pathname === href;

  return (
    <Link
      href={href}
      className={`relative px-1 py-1.5 text-sm font-medium transition-colors duration-200 ${
        isActive
          ? "text-white"
          : "text-neutral-500 hover:text-neutral-300"
      }`}
    >
      {children}
      {isActive && (
        <span className="absolute inset-x-0 -bottom-px h-0.5 rounded-full bg-gradient-to-r from-cyan-400 to-blue-500" />
      )}
    </Link>
  );
}
