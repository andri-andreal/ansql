import { useState } from "react";
import { Database, KeyRound, Leaf, MoreVertical, Edit, Trash2, Plug, AlertCircle, Loader2, Check } from "lucide-react";
import { useTranslation } from "../../i18n";
import type { Connection, DatabaseDriver } from "../../types";

interface ConnectionCardProps {
  connection: Connection;
  isSelected?: boolean;
  isConnected?: boolean;
  isConnecting?: boolean;
  onSelect: (connection: Connection) => void;
  onEdit: (connection: Connection) => void;
  onDelete: (id: string) => void;
  onConnect: (connection: Connection) => void;
}

const DRIVER_COLORS: Record<DatabaseDriver, string> = {
  mysql: "text-orange-500",
  postgres: "text-blue-500",
  sqlite: "text-green-500",
  sqlserver: "text-red-500",
  redis: "text-rose-600",
  mongodb: "text-emerald-600",
};

const DRIVER_LABELS: Record<DatabaseDriver, string> = {
  mysql: "MySQL",
  postgres: "PostgreSQL",
  sqlite: "SQLite",
  sqlserver: "SQL Server",
  redis: "Redis",
  mongodb: "MongoDB",
};

function ConnectionCard({
  connection,
  isSelected,
  isConnected,
  isConnecting,
  onSelect,
  onEdit,
  onDelete,
  onConnect,
}: ConnectionCardProps) {
  const { t } = useTranslation();
  const [showMenu, setShowMenu] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  const handleDelete = () => {
    setShowDeleteConfirm(false);
    setShowMenu(false);
    onDelete(connection.id);
  };

  const driverColor = DRIVER_COLORS[connection.driver as DatabaseDriver] || "text-gray-500";
  const driverLabel = DRIVER_LABELS[connection.driver as DatabaseDriver] || connection.driver;
  const DriverIcon =
    connection.driver === "redis"
      ? KeyRound
      : connection.driver === "mongodb"
      ? Leaf
      : Database;

  const getConnectButtonContent = () => {
    if (isConnecting) {
      return (
        <>
          <Loader2 className="w-4 h-4 animate-spin" />
          {t("connection.connecting")}
        </>
      );
    }
    if (isConnected) {
      return (
        <>
          <Check className="w-4 h-4" />
          {t("connection.connected")}
        </>
      );
    }
    return (
      <>
        <Plug className="w-4 h-4" />
        {t("connection.connect")}
      </>
    );
  };

  return (
    <div
      className={`relative rounded-xl p-4 cursor-pointer transition-all border-2 ${
        isSelected
          ? "border-primary bg-accent shadow-md"
          : "border-border bg-card hover:border-muted hover:shadow-sm"
      }`}
      onClick={() => onSelect(connection)}
    >
      {/* Header */}
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-3">
          <div className={`p-2 rounded-lg bg-secondary ${driverColor}`}>
            <DriverIcon className="w-5 h-5" />
          </div>
          <div>
            <h3 className="font-medium text-foreground">{connection.name}</h3>
            <span className={`text-xs font-medium ${driverColor}`}>{driverLabel}</span>
          </div>
        </div>

        {/* Menu Button */}
        <div className="relative">
          <button
            onClick={(e) => {
              e.stopPropagation();
              setShowMenu(!showMenu);
            }}
            className="p-1.5 hover:bg-secondary rounded-lg transition-colors"
          >
            <MoreVertical className="w-4 h-4 text-muted-foreground" />
          </button>

          {/* Dropdown Menu */}
          {showMenu && (
            <>
              <div
                className="fixed inset-0 z-10"
                onClick={(e) => {
                  e.stopPropagation();
                  setShowMenu(false);
                }}
              />
              <div className="absolute right-0 top-8 w-40 bg-popover border border-border rounded-lg shadow-lg z-20 py-1">
                {!isConnected && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setShowMenu(false);
                      onConnect(connection);
                    }}
                    disabled={isConnecting}
                    className="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-accent transition-colors disabled:opacity-50"
                  >
                    {isConnecting ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        {t("connection.connecting")}
                      </>
                    ) : (
                      <>
                        <Plug className="w-4 h-4" />
                        {t("connection.connect")}
                      </>
                    )}
                  </button>
                )}
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setShowMenu(false);
                    onEdit(connection);
                  }}
                  className="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-accent transition-colors"
                >
                  <Edit className="w-4 h-4" />
                  {t("connection.edit")}
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setShowMenu(false);
                    setShowDeleteConfirm(true);
                  }}
                  className="w-full flex items-center gap-2 px-3 py-2 text-sm text-destructive hover:bg-destructive/10 transition-colors"
                >
                  <Trash2 className="w-4 h-4" />
                  {t("connection.delete")}
                </button>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Connection Details */}
      <div className="space-y-1 text-sm text-muted-foreground">
        {connection.driver !== "sqlite" ? (
          <>
            <p className="truncate">
              {connection.host || "localhost"}:{connection.port}
            </p>
            {connection.database && (
              <p className="truncate">{t("connection.databaseLabel", { database: connection.database })}</p>
            )}
            {connection.username && (
              <p className="truncate">{t("connection.userLabel", { user: connection.username })}</p>
            )}
          </>
        ) : (
          <p className="truncate">{connection.database || t("connection.noFileSelected")}</p>
        )}
      </div>

      {/* Quick Connect Button */}
      <button
        onClick={(e) => {
          e.stopPropagation();
          if (!isConnected && !isConnecting) {
            onConnect(connection);
          }
        }}
        disabled={isConnecting}
        className={`mt-3 w-full flex items-center justify-center gap-2 px-3 py-2 text-sm font-medium rounded-lg transition-colors ${
          isConnected
            ? "bg-green-500/10 text-green-600 cursor-default"
            : isConnecting
            ? "bg-primary/10 text-primary cursor-wait"
            : "bg-primary/10 text-primary hover:bg-primary/20"
        }`}
      >
        {getConnectButtonContent()}
      </button>

      {/* Delete Confirmation Modal */}
      {showDeleteConfirm && (
        <div
          className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
          onClick={(e) => {
            e.stopPropagation();
            setShowDeleteConfirm(false);
          }}
        >
          <div
            className="bg-card rounded-lg p-6 shadow-xl max-w-sm w-full mx-4 animate-scale-in"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-3 mb-4">
              <div className="p-2 rounded-full bg-destructive/10">
                <AlertCircle className="w-5 h-5 text-destructive" />
              </div>
              <h3 className="text-lg font-semibold">{t("connection.deleteConnection")}</h3>
            </div>
            <p className="text-muted-foreground mb-6">
              {t("connection.deleteConfirm", { name: connection.name })}
            </p>
            <div className="flex justify-end gap-2">
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setShowDeleteConfirm(false);
                }}
                className="px-4 py-2 text-sm font-medium hover:bg-secondary rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  handleDelete();
                }}
                className="px-4 py-2 text-sm font-medium bg-destructive text-destructive-foreground rounded-lg hover:bg-destructive/90 transition-colors"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default ConnectionCard;
