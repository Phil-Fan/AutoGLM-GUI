import { createFileRoute } from '@tanstack/react-router';
import * as React from 'react';
import { useState, useRef, useEffect } from 'react';
import {
  sendMessageStream,
  initAgent,
  resetChat,
  getStatus,
  getScreenshot,
  listDevices,
  type StepEvent,
  type DoneEvent,
  type ErrorEvent,
  type ScreenshotResponse,
  type Device,
} from '../api';
import { ScrcpyPlayer } from '../components/ScrcpyPlayer';

export const Route = createFileRoute('/chat')({
  component: ChatComponent,
});

interface Message {
  id: string;
  role: 'user' | 'agent';
  content: string;
  timestamp: Date;
  steps?: number;
  success?: boolean;
  thinking?: string[]; // 存储每步的思考过程
  actions?: any[]; // 存储每步的动作
  isStreaming?: boolean; // 标记是否正在流式接收
}

// 每个设备的独立状态
interface DeviceState {
  messages: Message[];
  loading: boolean;
  error: string | null;
  initialized: boolean;
  currentStream: { close: () => void } | null;
  screenshot: ScreenshotResponse | null;
  useVideoStream: boolean;
  videoStreamFailed: boolean;
  displayMode: 'auto' | 'video' | 'screenshot';
  tapFeedback: string | null;
}

function ChatComponent() {
  // 设备列表和当前选中设备
  const [devices, setDevices] = useState<Device[]>([]);
  const [currentDeviceId, setCurrentDeviceId] = useState<string>('');

  // 每个设备的独立状态
  const [deviceStates, setDeviceStates] = useState<Map<string, DeviceState>>(
    new Map()
  );

  // 全局配置（所有设备共享）
  const [config, setConfig] = useState({
    baseUrl: '',
    apiKey: '',
    modelName: '',
  });
  const [showConfig, setShowConfig] = useState(false);

  // 旧状态保留用于向后兼容（已废弃）
  const [input, setInput] = useState('');

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const screenshotFetchingRef = useRef(false);

  // 用于追踪当前流式消息的最新数据，避免状态更新竞态
  const currentThinkingRef = useRef<string[]>([]);
  const currentActionsRef = useRef<any[]>([]);

  // 获取当前设备的状态（如果不存在则返回默认值）
  const getCurrentDeviceState = (): DeviceState => {
    return (
      deviceStates.get(currentDeviceId) || {
        messages: [],
        loading: false,
        error: null,
        initialized: false,
        currentStream: null,
        screenshot: null,
        useVideoStream: true,
        videoStreamFailed: false,
        displayMode: 'auto' as const,
        tapFeedback: null,
      }
    );
  };

  // 更新特定设备的状态
  const updateDeviceState = (
    deviceId: string,
    updates: Partial<DeviceState>
  ) => {
    setDeviceStates(prev => {
      const newMap = new Map(prev);
      const currentState = newMap.get(deviceId) || {
        messages: [],
        loading: false,
        error: null,
        initialized: false,
        currentStream: null,
        screenshot: null,
        useVideoStream: true,
        videoStreamFailed: false,
        displayMode: 'auto' as const,
        tapFeedback: null,
      };
      newMap.set(deviceId, { ...currentState, ...updates });
      return newMap;
    });
  };

  // 当前设备状态的快捷访问
  const currentState = getCurrentDeviceState();

  // 滚动到底部
  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [currentState.messages]);

  // 加载设备列表
  useEffect(() => {
    const loadDevices = async () => {
      try {
        const response = await listDevices();
        setDevices(response.devices);

        // 自动选择第一个设备（如果当前没有选中设备）
        if (response.devices.length > 0 && !currentDeviceId) {
          setCurrentDeviceId(response.devices[0].id);
        }
      } catch (error) {
        console.error('Failed to load devices:', error);
      }
    };

    loadDevices();
    // 每3秒刷新设备列表
    const interval = setInterval(loadDevices, 3000);
    return () => clearInterval(interval);
  }, [currentDeviceId]);

  // 截图轮询 (在 fallback 模式或用户手动选择截图模式时运行)
  useEffect(() => {
    if (!currentDeviceId) return;

    const shouldPollScreenshots =
      currentState.displayMode === 'screenshot' ||
      (currentState.displayMode === 'auto' && currentState.videoStreamFailed);

    if (!shouldPollScreenshots) {
      return; // Don't poll screenshots
    }

    const fetchScreenshot = async () => {
      // 如果有正在进行的请求，跳过本次请求
      if (screenshotFetchingRef.current) {
        return;
      }

      screenshotFetchingRef.current = true;
      try {
        const data = await getScreenshot(currentDeviceId);
        if (data.success) {
          updateDeviceState(currentDeviceId, { screenshot: data });
        }
      } catch (e) {
        console.error('Failed to fetch screenshot:', e);
      } finally {
        screenshotFetchingRef.current = false;
      }
    };

    // 立即获取一次
    fetchScreenshot();

    // 设置定时器每 0.5 秒刷新
    const interval = setInterval(fetchScreenshot, 500);

    return () => clearInterval(interval);
  }, [
    currentDeviceId,
    currentState.videoStreamFailed,
    currentState.displayMode,
  ]);

  // 初始化特定设备的 Agent
  const handleInit = async (deviceId: string) => {
    try {
      await initAgent({
        model_config: {
          base_url: config.baseUrl || undefined,
          api_key: config.apiKey || undefined,
          model_name: config.modelName || undefined,
        },
        agent_config: {
          device_id: deviceId,
        },
      });
      updateDeviceState(deviceId, { initialized: true, error: null });
      setShowConfig(false);
    } catch (error) {
      updateDeviceState(deviceId, {
        error:
          error instanceof Error
            ? error.message
            : '初始化失败，请检查配置或确保后端服务正在运行',
      });
    }
  };

  // 发送消息（流式）
  const handleSend = async () => {
    if (!input.trim() || currentState.loading) return;

    // 检查是否选中了设备
    if (!currentDeviceId) {
      alert('请先选择一个设备');
      return;
    }

    // 如果设备未初始化，先初始化
    if (!currentState.initialized) {
      await handleInit(currentDeviceId);
    }

    const userMessage: Message = {
      id: Date.now().toString(),
      role: 'user',
      content: input.trim(),
      timestamp: new Date(),
    };

    // 更新设备状态：添加用户消息
    updateDeviceState(currentDeviceId, {
      messages: [...currentState.messages, userMessage],
      loading: true,
      error: null,
    });

    setInput('');

    // 重置当前流式消息的 ref
    currentThinkingRef.current = [];
    currentActionsRef.current = [];

    // 创建占位 Agent 消息
    const agentMessageId = (Date.now() + 1).toString();
    const agentMessage: Message = {
      id: agentMessageId,
      role: 'agent',
      content: '',
      timestamp: new Date(),
      thinking: [],
      actions: [],
      isStreaming: true,
    };

    // 更新设备状态：添加 Agent 消息占位符
    updateDeviceState(currentDeviceId, {
      messages: [...currentState.messages, userMessage, agentMessage],
    });

    // 启动流式接收
    const stream = sendMessageStream(
      userMessage.content,
      currentDeviceId, // 传递设备 ID
      // onStep
      (event: StepEvent) => {
        console.log('[Chat] Processing step event:', event);

        // 先更新 ref（这是同步的，不会有竞态）
        currentThinkingRef.current.push(event.thinking);
        currentActionsRef.current.push(event.action);

        // 获取最新的设备状态并更新消息
        setDeviceStates(prev => {
          const newMap = new Map(prev);
          const state = newMap.get(currentDeviceId);
          if (!state) return prev;

          const updatedMessages = state.messages.map(msg =>
            msg.id === agentMessageId
              ? {
                  ...msg,
                  thinking: [...currentThinkingRef.current],
                  actions: [...currentActionsRef.current],
                  steps: event.step,
                }
              : msg
          );

          newMap.set(currentDeviceId, { ...state, messages: updatedMessages });
          return newMap;
        });
      },
      // onDone
      (event: DoneEvent) => {
        setDeviceStates(prev => {
          const newMap = new Map(prev);
          const state = newMap.get(currentDeviceId);
          if (!state) return prev;

          const updatedMessages = state.messages.map(msg =>
            msg.id === agentMessageId
              ? {
                  ...msg,
                  content: event.message,
                  success: event.success,
                  isStreaming: false,
                }
              : msg
          );

          newMap.set(currentDeviceId, {
            ...state,
            messages: updatedMessages,
            loading: false,
            currentStream: null,
          });
          return newMap;
        });
      },
      // onError
      (event: ErrorEvent) => {
        setDeviceStates(prev => {
          const newMap = new Map(prev);
          const state = newMap.get(currentDeviceId);
          if (!state) return prev;

          const updatedMessages = state.messages.map(msg =>
            msg.id === agentMessageId
              ? {
                  ...msg,
                  content: `错误: ${event.message}`,
                  success: false,
                  isStreaming: false,
                }
              : msg
          );

          newMap.set(currentDeviceId, {
            ...state,
            messages: updatedMessages,
            loading: false,
            currentStream: null,
            error: event.message,
          });
          return newMap;
        });
      }
    );

    // 保存流对象到设备状态
    updateDeviceState(currentDeviceId, { currentStream: stream });
  };

  // 重置当前设备的对话
  const handleReset = async () => {
    if (!currentDeviceId) return;

    // 取消正在进行的流式请求
    if (currentState.currentStream) {
      currentState.currentStream.close();
    }

    // 重置设备状态
    updateDeviceState(currentDeviceId, {
      messages: [],
      loading: false,
      error: null,
      currentStream: null,
    });

    // 调用后端重置
    await resetChat(currentDeviceId);
  };

  // 切换设备
  const handleDeviceChange = (deviceId: string) => {
    // 停止当前设备的流
    if (currentState.currentStream) {
      currentState.currentStream.close();
      updateDeviceState(currentDeviceId, { currentStream: null });
    }

    setCurrentDeviceId(deviceId);
  };

  const handleInputKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="h-full flex items-center justify-center p-4 gap-4 relative">
      {/* Config Modal */}
      {showConfig && (
        <div className="absolute inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 rounded-2xl">
          <div className="bg-white dark:bg-gray-800 p-6 rounded-2xl w-96 shadow-xl border border-gray-200 dark:border-gray-700">
            <h2 className="text-xl font-bold mb-4 text-gray-900 dark:text-gray-100">
              Agent 配置
            </h2>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-1 text-gray-700 dark:text-gray-300">
                  Base URL
                </label>
                <input
                  type="text"
                  value={config.baseUrl}
                  onChange={e =>
                    setConfig({ ...config, baseUrl: e.target.value })
                  }
                  placeholder="留空使用默认值"
                  className="w-full px-3 py-2 border rounded-lg bg-white dark:bg-gray-700 border-gray-300 dark:border-gray-600 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-blue-500 outline-none"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1 text-gray-700 dark:text-gray-300">
                  API Key
                </label>
                <input
                  type="password"
                  value={config.apiKey}
                  onChange={e =>
                    setConfig({ ...config, apiKey: e.target.value })
                  }
                  placeholder="留空使用默认值"
                  className="w-full px-3 py-2 border rounded-lg bg-white dark:bg-gray-700 border-gray-300 dark:border-gray-600 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-blue-500 outline-none"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1 text-gray-700 dark:text-gray-300">
                  Model Name
                </label>
                <input
                  type="text"
                  value={config.modelName}
                  onChange={e =>
                    setConfig({ ...config, modelName: e.target.value })
                  }
                  placeholder="留空使用默认值"
                  className="w-full px-3 py-2 border rounded-lg bg-white dark:bg-gray-700 border-gray-300 dark:border-gray-600 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-blue-500 outline-none"
                />
              </div>
              <div className="flex justify-end gap-2 mt-6">
                <button
                  onClick={() => setShowConfig(false)}
                  className="px-4 py-2 text-gray-600 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200"
                >
                  取消
                </button>
                <button
                  onClick={() => {
                    if (currentDeviceId) {
                      handleInit(currentDeviceId);
                    } else {
                      alert('请先选择一个设备');
                    }
                  }}
                  className="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors"
                >
                  确认配置
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Chatbox */}
      <div className="flex flex-col w-full max-w-2xl h-[750px] border border-gray-200 dark:border-gray-700 rounded-2xl shadow-lg bg-white dark:bg-gray-800">
        {/* 头部 */}
        <div className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-700 rounded-t-2xl">
          <div className="flex items-center gap-4">
            <h1 className="text-xl font-semibold">AutoGLM Chat</h1>

            {/* 设备选择器 */}
            <div className="flex items-center gap-2">
              <label className="text-sm text-gray-600 dark:text-gray-400">
                设备:
              </label>
              <select
                value={currentDeviceId}
                onChange={e => handleDeviceChange(e.target.value)}
                className="px-3 py-1 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="">选择设备</option>
                {devices.map(device => (
                  <option key={device.id} value={device.id}>
                    {device.model} ({device.id})
                    {device.is_initialized ? ' ✓' : ''}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="flex gap-2">
            {currentDeviceId && !currentState.initialized ? (
              <button
                onClick={() => handleInit(currentDeviceId)}
                className="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors flex items-center justify-center"
              >
                初始化设备
              </button>
            ) : currentDeviceId ? (
              <span className="px-3 py-1 bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200 rounded-full text-sm flex items-center justify-center">
                已初始化
              </span>
            ) : null}
            <button
              onClick={() => setShowConfig(true)}
              className="px-3 py-2 bg-gray-200 dark:bg-gray-700 rounded-lg hover:bg-gray-300 dark:hover:bg-gray-600 transition-colors"
            >
              配置
            </button>
            <button
              onClick={handleReset}
              disabled={!currentDeviceId}
              className="px-4 py-2 bg-gray-200 dark:bg-gray-700 rounded-lg hover:bg-gray-300 dark:hover:bg-gray-600 transition-colors flex items-center justify-center disabled:opacity-50 disabled:cursor-not-allowed"
            >
              重置
            </button>
          </div>
        </div>

        {/* 错误提示 */}
        {currentState.error && (
          <div className="mx-4 mt-4 p-3 bg-red-100 dark:bg-red-900 text-red-700 dark:text-red-200 rounded-lg">
            {currentState.error}
          </div>
        )}

        {/* 消息列表 */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {!currentDeviceId ? (
            <div className="text-center text-gray-500 dark:text-gray-400 mt-8">
              <p className="text-lg">欢迎使用 AutoGLM Chat</p>
              <p className="text-sm mt-2">请先选择一个设备</p>
            </div>
          ) : currentState.messages.length === 0 ? (
            <div className="text-center text-gray-500 dark:text-gray-400 mt-8">
              <p className="text-lg">设备已选择</p>
              <p className="text-sm mt-2">输入任务描述，让 AI 帮你操作手机</p>
            </div>
          ) : null}

          {currentState.messages.map(message => (
            <div
              key={message.id}
              className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
            >
              {message.role === 'agent' ? (
                <div className="max-w-[80%] space-y-2">
                  {/* 显示每步思考过程 */}
                  {message.thinking?.map((think, idx) => (
                    <div
                      key={idx}
                      className="bg-gray-100 dark:bg-gray-700 rounded-2xl px-4 py-3 border-l-4 border-blue-500"
                    >
                      <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">
                        💭 步骤 {idx + 1} - 思考过程
                      </div>
                      <p className="text-sm whitespace-pre-wrap">{think}</p>

                      {message.actions?.[idx] && (
                        <details className="mt-2 text-xs">
                          <summary className="cursor-pointer text-blue-500 hover:text-blue-600">
                            查看动作
                          </summary>
                          <pre className="mt-1 p-2 bg-gray-800 text-gray-200 rounded overflow-x-auto text-xs">
                            {JSON.stringify(message.actions[idx], null, 2)}
                          </pre>
                        </details>
                      )}
                    </div>
                  ))}

                  {/* 最终结果 */}
                  {message.content && (
                    <div
                      className={`rounded-2xl px-4 py-3 ${
                        message.success === false
                          ? 'bg-red-100 dark:bg-red-900 text-red-800 dark:text-red-200'
                          : 'bg-green-100 dark:bg-green-900 text-green-800 dark:text-green-200'
                      }`}
                    >
                      <p className="whitespace-pre-wrap">{message.content}</p>
                      {message.steps !== undefined && (
                        <p className="text-xs mt-2 opacity-70">
                          总步数: {message.steps}
                        </p>
                      )}
                    </div>
                  )}

                  {/* 流式加载提示 */}
                  {message.isStreaming && (
                    <div className="text-sm text-gray-500 dark:text-gray-400 animate-pulse">
                      正在执行...
                    </div>
                  )}
                </div>
              ) : (
                <div className="max-w-[70%] rounded-2xl px-4 py-3 bg-blue-500 text-white">
                  <p className="whitespace-pre-wrap">{message.content}</p>
                </div>
              )}
            </div>
          ))}

          <div ref={messagesEndRef} />
        </div>

        {/* 输入区域 */}
        <div className="p-4 border-t border-gray-200 dark:border-gray-700 rounded-b-2xl">
          <div className="flex gap-2">
            <input
              type="text"
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={handleInputKeyDown}
              placeholder={
                !currentDeviceId
                  ? '请先选择设备'
                  : !currentState.initialized
                    ? '请先初始化设备'
                    : '输入任务描述...'
              }
              disabled={!currentDeviceId || currentState.loading}
              className="flex-1 px-4 py-3 border border-gray-300 dark:border-gray-600 rounded-xl bg-white dark:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
            />
            <button
              onClick={handleSend}
              disabled={!currentDeviceId || currentState.loading || !input.trim()}
              className="px-6 py-3 bg-blue-500 text-white rounded-xl hover:bg-blue-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center"
            >
              发送
            </button>
          </div>
        </div>
      </div>

      {/* Real-time Video Stream or Screenshot Fallback */}
      <div className="w-full max-w-xs h-[750px] border border-gray-200 dark:border-gray-700 rounded-2xl shadow-lg bg-gray-900 overflow-hidden relative">
        {/* Mode Switch Button */}
        {currentDeviceId && (
          <div className="absolute top-2 right-2 z-10 flex gap-1 bg-black/70 rounded-lg p-1">
            <button
              onClick={() =>
                updateDeviceState(currentDeviceId, { displayMode: 'auto' })
              }
              className={`px-3 py-1 text-xs rounded transition-colors ${
                currentState.displayMode === 'auto'
                  ? 'bg-blue-500 text-white'
                  : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
              }`}
              title="自动选择最佳显示模式"
            >
              自动
            </button>
            <button
              onClick={() =>
                updateDeviceState(currentDeviceId, { displayMode: 'video' })
              }
              className={`px-3 py-1 text-xs rounded transition-colors ${
                currentState.displayMode === 'video'
                  ? 'bg-blue-500 text-white'
                  : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
              }`}
              title="强制使用视频流"
            >
              视频流
            </button>
            <button
              onClick={() =>
                updateDeviceState(currentDeviceId, {
                  displayMode: 'screenshot',
                })
              }
              className={`px-3 py-1 text-xs rounded transition-colors ${
                currentState.displayMode === 'screenshot'
                  ? 'bg-blue-500 text-white'
                  : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
              }`}
              title="使用截图模式 (0.5s刷新)"
            >
              截图
            </button>
          </div>
        )}

        {currentDeviceId &&
        (currentState.displayMode === 'video' ||
          (currentState.displayMode === 'auto' &&
            currentState.useVideoStream &&
            !currentState.videoStreamFailed)) ? (
          <>
            {/* Tap feedback toast */}
            {currentState.tapFeedback && (
              <div className="absolute top-14 right-2 z-20 px-3 py-2 bg-blue-500 text-white text-sm rounded-lg shadow-lg animate-fade-in">
                {currentState.tapFeedback}
              </div>
            )}

            <ScrcpyPlayer
              deviceId={currentDeviceId}
              className="w-full h-full"
              enableControl={true}
              onFallback={() => {
                updateDeviceState(currentDeviceId, {
                  videoStreamFailed: true,
                  useVideoStream: false,
                });
              }}
              onTapSuccess={() => {
                updateDeviceState(currentDeviceId, {
                  tapFeedback: 'Tap executed',
                });
                setTimeout(
                  () =>
                    updateDeviceState(currentDeviceId, { tapFeedback: null }),
                  2000
                );
              }}
              onTapError={error => {
                updateDeviceState(currentDeviceId, {
                  tapFeedback: `Tap failed: ${error}`,
                });
                setTimeout(
                  () =>
                    updateDeviceState(currentDeviceId, { tapFeedback: null }),
                  3000
                );
              }}
              onSwipeSuccess={() => {
                updateDeviceState(currentDeviceId, {
                  tapFeedback: 'Swipe executed',
                });
                setTimeout(
                  () =>
                    updateDeviceState(currentDeviceId, { tapFeedback: null }),
                  2000
                );
              }}
              onSwipeError={error => {
                updateDeviceState(currentDeviceId, {
                  tapFeedback: `Swipe failed: ${error}`,
                });
                setTimeout(
                  () =>
                    updateDeviceState(currentDeviceId, { tapFeedback: null }),
                  3000
                );
              }}
              fallbackTimeout={100000}
            />
          </>
        ) : currentDeviceId ? (
          <div className="w-full h-full flex items-center justify-center bg-gray-900">
            {currentState.screenshot && currentState.screenshot.success ? (
              <div className="relative w-full h-full flex items-center justify-center">
                <img
                  src={`data:image/png;base64,${currentState.screenshot.image}`}
                  alt="Device Screenshot"
                  className="max-w-full max-h-full object-contain"
                  style={{
                    width:
                      currentState.screenshot.width >
                      currentState.screenshot.height
                        ? '100%'
                        : 'auto',
                    height:
                      currentState.screenshot.width >
                      currentState.screenshot.height
                        ? 'auto'
                        : '100%',
                  }}
                />
                {currentState.screenshot.is_sensitive && (
                  <div className="absolute top-12 right-2 px-2 py-1 bg-yellow-500 text-white text-xs rounded">
                    敏感内容
                  </div>
                )}
                {/* Mode indicator */}
                <div className="absolute bottom-2 left-2 px-2 py-1 bg-blue-500 text-white text-xs rounded">
                  截图模式 (0.5s 刷新)
                  {currentState.displayMode === 'auto' &&
                    currentState.videoStreamFailed &&
                    ' - 视频流不可用'}
                </div>
              </div>
            ) : currentState.screenshot?.error ? (
              <div className="text-center text-red-500 dark:text-red-400">
                <p className="mb-2">截图失败</p>
                <p className="text-xs">{currentState.screenshot.error}</p>
              </div>
            ) : (
              <div className="text-center text-gray-500 dark:text-gray-400">
                <div className="w-8 h-8 border-4 border-gray-300 border-t-blue-500 rounded-full animate-spin mx-auto mb-2" />
                <p>加载中...</p>
              </div>
            )}
          </div>
        ) : (
          <div className="w-full h-full flex items-center justify-center bg-gray-900">
            <div className="text-center text-gray-500 dark:text-gray-400">
              <p className="text-lg">未选择设备</p>
              <p className="text-sm mt-2">请先选择一个设备</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
