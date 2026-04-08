import Link from "next/link";

export default function SectionHeader({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle?: string;
  action?: { label: string; href: string };
}) {
  return (
    <div className="flex items-end justify-between mb-4">
      <div>
        <h2 className="text-lg font-semibold text-white">{title}</h2>
        {subtitle && (
          <p className="text-xs text-neutral-500 mt-0.5">{subtitle}</p>
        )}
      </div>
      {action && (
        <Link
          href={action.href}
          className="text-xs font-medium text-cyan-400 hover:text-cyan-300 transition-colors duration-150"
        >
          {action.label} &rarr;
        </Link>
      )}
    </div>
  );
}
