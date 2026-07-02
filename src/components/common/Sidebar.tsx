import { LucideIcon, Moon, Sun } from "lucide-react";
import { useTheme } from "../../hooks/useTheme";
import { useTranslation } from "../../i18n";

interface SidebarItem {
  id: string;
  label: string;
  icon: LucideIcon;
}

interface SidebarProps {
  items: SidebarItem[];
  activeSection: string;
  onSectionChange: (section: string) => void;
}

function Sidebar({ items, activeSection, onSectionChange }: SidebarProps) {
  const { theme, toggleTheme } = useTheme();
  const { t } = useTranslation();

  return (
    <aside className="w-48 bg-secondary border-r border-border flex flex-col shrink-0">
      <nav className="flex-1 p-3">
        <ul className="space-y-1">
          {items.map((item) => {
            const Icon = item.icon;
            const isActive = activeSection === item.id;

            return (
              <li key={item.id}>
                <button
                  onClick={() => onSectionChange(item.id)}
                  className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors ${
                    isActive
                      ? "bg-accent text-accent-foreground font-medium"
                      : "text-foreground hover:bg-accent/50"
                  }`}
                >
                  <Icon className={`w-4 h-4 ${isActive ? "text-primary" : ""}`} />
                  {item.label}
                </button>
              </li>
            );
          })}
        </ul>
      </nav>

      {/* Theme Toggle */}
      <div className="p-3 border-t border-border">
        <button
          onClick={toggleTheme}
          className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm text-foreground hover:bg-accent/50 transition-colors"
          title={theme === 'light' ? t("shell.switchToDarkMode") : t("shell.switchToLightMode")}
        >
          {theme === 'light' ? (
            <>
              <Moon className="w-4 h-4" />
              {t("shell.darkMode")}
            </>
          ) : (
            <>
              <Sun className="w-4 h-4" />
              {t("shell.lightMode")}
            </>
          )}
        </button>
      </div>
    </aside>
  );
}

export default Sidebar;
