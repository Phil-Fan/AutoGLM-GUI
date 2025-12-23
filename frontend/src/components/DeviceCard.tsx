import React, { useState } from 'react';
import { Wifi, WifiOff, CheckCircle2, Smartphone, Loader2, Apple } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ConfirmDialog } from './ConfirmDialog';
import { useTranslation } from '../lib/i18n-context';

interface DeviceCardProps {
  id: string;
  model: string;
  status: string;
  connectionType?: string;
  deviceType?: string; // 'adb' (Android) 或 'ios'
  isInitialized: boolean;
  isActive: boolean;
  onClick: () => void;
  onConnectWifi?: () => Promise<void>;
  onDisconnectWifi?: () => Promise<void>;
}

export function DeviceCard({
  id,
  model,
  status,
  connectionType,
  deviceType,
  isInitialized,
  isActive,
  onClick,
  onConnectWifi,
  onDisconnectWifi,
}: DeviceCardProps) {
  const isIos = deviceType === 'ios';
  const t = useTranslation();
  const isOnline = status === 'device';
  const isUsb = connectionType === 'usb';
  const isRemote = connectionType === 'remote';
  const [loading, setLoading] = useState(false);
  const [showWifiConfirm, setShowWifiConfirm] = useState(false);
  const [showDisconnectConfirm, setShowDisconnectConfirm] = useState(false);

  const handleWifiClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (loading || !onConnectWifi) return;
    setShowWifiConfirm(true);
  };

  const handleDisconnectClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (loading || !onDisconnectWifi) return;
    setShowDisconnectConfirm(true);
  };

  const handleConfirmWifi = async () => {
    setShowWifiConfirm(false);
    setLoading(true);
    try {
      if (onConnectWifi) {
        await onConnectWifi();
      }
    } finally {
      setLoading(false);
    }
  };

  const handleConfirmDisconnect = async () => {
    setShowDisconnectConfirm(false);
    setLoading(true);
    try {
      if (onDisconnectWifi) {
        await onDisconnectWifi();
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <div
        onClick={onClick}
        role="button"
        tabIndex={0}
        onKeyDown={e => {
          if (e.key === 'Enter' || e.key === ' ') {
            onClick();
          }
        }}
        className={`
          group relative w-full text-left p-4 rounded-xl transition-all duration-200 cursor-pointer
          border-2
          ${
            isActive
              ? 'bg-slate-50 border-[#1d9bf0] dark:bg-slate-800/50 dark:border-[#1d9bf0]'
              : 'bg-white border-transparent hover:border-slate-200 dark:bg-slate-900 dark:hover:border-slate-700'
          }
        `}
      >
        {/* Active indicator bar */}
        {isActive && (
          <div className="absolute left-0 top-2 bottom-2 w-1 bg-[#1d9bf0] rounded-r" />
        )}

        <div className="flex items-center gap-3 pl-2">
          {/* Device icon and info */}
          <div className="flex-1 min-w-0 flex flex-col justify-center gap-0.5">
            <div className="flex items-center gap-2">
              <Smartphone
                className={`w-4 h-4 ${
                  isActive
                    ? 'text-[#1d9bf0]'
                    : 'text-slate-400 dark:text-slate-500'
                }`}
              />
              <span
                className={`font-semibold text-sm truncate ${
                  isActive
                    ? 'text-slate-900 dark:text-slate-100'
                    : 'text-slate-700 dark:text-slate-300'
                }`}
              >
                {model || t.deviceCard.unknownDevice}
              </span>
            </div>
            <span
              className={`text-xs font-mono truncate ${
                isActive
                  ? 'text-slate-500 dark:text-slate-400'
                  : 'text-slate-400 dark:text-slate-500'
              }`}
            >
              {id}
            </span>
          </div>

          {/* Status indicators */}
          <div className="flex items-center gap-1.5">
            {/* Device type icon */}
            <div
              className={`w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 ${
                isOnline
                  ? isIos
                    ? 'bg-slate-100 dark:bg-slate-800'
                    : 'bg-green-100 dark:bg-green-900/30'
                  : 'bg-slate-50 dark:bg-slate-900'
              }`}
              title={isIos ? 'iOS' : 'Android'}
            >
              {isIos ? (
                <Apple className="w-3.5 h-3.5 text-slate-600 dark:text-slate-400" />
              ) : (
                <Smartphone className="w-3.5 h-3.5 text-green-600 dark:text-green-400" />
              )}
            </div>

            {/* Initialized status */}
            {isInitialized && (
              <div
                className="w-6 h-6 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center flex-shrink-0"
                title={t.deviceCard.ready}
              >
                <CheckCircle2 className="w-3.5 h-3.5 text-green-600 dark:text-green-400" />
              </div>
            )}
          </div>

          {isUsb && onConnectWifi && (
            <Button
              variant="ghost"
              size="icon"
              onClick={handleWifiClick}
              disabled={loading}
              className={`h-8 w-8 rounded-full ${
                isActive
                  ? 'bg-[#1d9bf0]/10 text-[#1d9bf0] hover:bg-[#1d9bf0]/20'
                  : 'text-slate-400 dark:text-slate-500 hover:text-[#1d9bf0] dark:hover:text-[#1d9bf0] hover:bg-slate-100 dark:hover:bg-slate-800'
              }`}
              title={t.deviceCard.connectViaWifi}
            >
              {loading ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Wifi className="w-4 h-4" />
              )}
            </Button>
          )}

          {isRemote && onDisconnectWifi && (
            <Button
              variant="ghost"
              size="icon"
              onClick={handleDisconnectClick}
              disabled={loading}
              className={`h-8 w-8 rounded-full ${
                isActive
                  ? 'bg-red-500/10 text-red-500 hover:bg-red-500/20'
                  : 'text-slate-400 dark:text-slate-500 hover:text-red-500 dark:hover:text-red-500 hover:bg-slate-100 dark:hover:bg-slate-800'
              }`}
              title={t.deviceCard.disconnectWifi}
            >
              {loading ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <WifiOff className="w-4 h-4" />
              )}
            </Button>
          )}
        </div>
      </div>

      <ConfirmDialog
        isOpen={showWifiConfirm}
        title={t.deviceCard.connectWifiTitle}
        content={t.deviceCard.connectWifiContent}
        onConfirm={handleConfirmWifi}
        onCancel={() => setShowWifiConfirm(false)}
      />

      <ConfirmDialog
        isOpen={showDisconnectConfirm}
        title={t.deviceCard.disconnectWifiTitle}
        content={t.deviceCard.disconnectWifiContent}
        onConfirm={handleConfirmDisconnect}
        onCancel={() => setShowDisconnectConfirm(false)}
      />
    </>
  );
}
