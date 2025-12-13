"""AutoGLM-GUI Backend API Server."""

import asyncio
import json
import os
from importlib.metadata import version as get_version
from importlib.resources import files
from pathlib import Path

from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from phone_agent import PhoneAgent
from phone_agent.agent import AgentConfig
from phone_agent.model import ModelConfig
from pydantic import BaseModel, Field

from AutoGLM_GUI.adb_plus import capture_screenshot
from AutoGLM_GUI.scrcpy_stream import ScrcpyStreamer

# 全局 scrcpy streamer 实例和锁（多设备支持）
scrcpy_streamers: dict[str, ScrcpyStreamer] = {}
scrcpy_locks: dict[str, asyncio.Lock] = {}

# 获取包版本号
try:
    __version__ = get_version("autoglm-gui")
except Exception:
    __version__ = "dev"

app = FastAPI(title="AutoGLM-GUI API", version=__version__)

# CORS 配置 (开发环境需要)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 多设备实例管理
agents: dict[str, PhoneAgent] = {}
agent_configs: dict[str, tuple[ModelConfig, AgentConfig]] = {}

# 默认配置 (优先从环境变量读取，支持 reload 模式)
DEFAULT_BASE_URL: str = os.getenv("AUTOGLM_BASE_URL", "")
DEFAULT_MODEL_NAME: str = os.getenv("AUTOGLM_MODEL_NAME", "autoglm-phone-9b")
DEFAULT_API_KEY: str = os.getenv("AUTOGLM_API_KEY", "EMPTY")


def _non_blocking_takeover(message: str) -> None:
    """Log takeover requests without blocking for console input."""
    print(f"[Takeover] {message}")


# 请求/响应模型
class APIModelConfig(BaseModel):
    base_url: str | None = None
    api_key: str | None = None
    model_name: str | None = None
    max_tokens: int = 3000
    temperature: float = 0.0
    top_p: float = 0.85
    frequency_penalty: float = 0.2


class APIAgentConfig(BaseModel):
    max_steps: int = 100
    device_id: str | None = None
    lang: str = "cn"
    system_prompt: str | None = None
    verbose: bool = True


class InitRequest(BaseModel):
    model: APIModelConfig | None = Field(default=None, alias="model_config")
    agent: APIAgentConfig | None = Field(default=None, alias="agent_config")


class ChatRequest(BaseModel):
    message: str
    device_id: str  # 设备 ID（必填）


class ChatResponse(BaseModel):
    result: str
    steps: int
    success: bool


class StatusResponse(BaseModel):
    version: str
    initialized: bool
    step_count: int


class ResetRequest(BaseModel):
    device_id: str  # 设备 ID（必填）


class ScreenshotRequest(BaseModel):
    device_id: str | None = None


class ScreenshotResponse(BaseModel):
    success: bool
    image: str  # base64 encoded PNG
    width: int
    height: int
    is_sensitive: bool
    error: str | None = None


class TapRequest(BaseModel):
    x: int
    y: int
    device_id: str | None = None
    delay: float = 0.0


class TapResponse(BaseModel):
    success: bool
    error: str | None = None


class SwipeRequest(BaseModel):
    start_x: int
    start_y: int
    end_x: int
    end_y: int
    duration_ms: int | None = None
    device_id: str | None = None
    delay: float = 0.0


class SwipeResponse(BaseModel):
    success: bool
    error: str | None = None


class TouchDownRequest(BaseModel):
    x: int
    y: int
    device_id: str | None = None
    delay: float = 0.0


class TouchDownResponse(BaseModel):
    success: bool
    error: str | None = None


class TouchMoveRequest(BaseModel):
    x: int
    y: int
    device_id: str | None = None
    delay: float = 0.0


class TouchMoveResponse(BaseModel):
    success: bool
    error: str | None = None


class TouchUpRequest(BaseModel):
    x: int
    y: int
    device_id: str | None = None
    delay: float = 0.0


class TouchUpResponse(BaseModel):
    success: bool
    error: str | None = None


# API 端点
@app.post("/api/init")
def init_agent(request: InitRequest) -> dict:
    """初始化 PhoneAgent（多设备支持）。"""
    global agents, agent_configs

    # 提取配置或使用空对象
    req_model_config = request.model or APIModelConfig()
    req_agent_config = request.agent or APIAgentConfig()

    # 必须指定 device_id
    device_id = req_agent_config.device_id
    if not device_id:
        raise HTTPException(
            status_code=400, detail="device_id is required in agent_config"
        )

    # 使用请求参数或默认值
    base_url = req_model_config.base_url or DEFAULT_BASE_URL
    api_key = req_model_config.api_key or DEFAULT_API_KEY
    model_name = req_model_config.model_name or DEFAULT_MODEL_NAME

    if not base_url:
        raise HTTPException(
            status_code=400, detail="base_url is required (in model_config or env)"
        )

    model_config = ModelConfig(
        base_url=base_url,
        api_key=api_key,
        model_name=model_name,
        max_tokens=req_model_config.max_tokens,
        temperature=req_model_config.temperature,
        top_p=req_model_config.top_p,
        frequency_penalty=req_model_config.frequency_penalty,
    )

    agent_config = AgentConfig(
        max_steps=req_agent_config.max_steps,
        device_id=device_id,
        lang=req_agent_config.lang,
        system_prompt=req_agent_config.system_prompt,
        verbose=req_agent_config.verbose,
    )

    # 创建并存储 Agent
    agents[device_id] = PhoneAgent(
        model_config=model_config,
        agent_config=agent_config,
        takeover_callback=_non_blocking_takeover,
    )

    # 记录配置，便于 reset 时自动重建
    agent_configs[device_id] = (model_config, agent_config)

    return {
        "success": True,
        "device_id": device_id,
        "message": f"Agent initialized for device {device_id}",
    }


@app.post("/api/chat", response_model=ChatResponse)
def chat(request: ChatRequest) -> ChatResponse:
    """发送任务给 Agent 并执行。"""
    global agent

    if agent is None:
        raise HTTPException(
            status_code=400, detail="Agent not initialized. Call /api/init first."
        )

    try:
        result = agent.run(request.message)
        steps = agent.step_count
        agent.reset()

        return ChatResponse(result=result, steps=steps, success=True)
    except Exception as e:
        return ChatResponse(result=str(e), steps=0, success=False)


@app.post("/api/chat/stream")
def chat_stream(request: ChatRequest):
    """发送任务给 Agent 并实时推送执行进度（SSE，多设备支持）。"""
    global agents

    device_id = request.device_id

    # 检查设备是否已初始化
    if device_id not in agents:
        raise HTTPException(
            status_code=400,
            detail=f"Device {device_id} not initialized. Call /api/init first.",
        )

    agent = agents[device_id]

    def event_generator():
        """SSE 事件生成器"""
        try:
            # 使用 step() 逐步执行
            step_result = agent.step(request.message)
            while True:
                # 发送 step 事件
                event_data = {
                    "type": "step",
                    "step": agent.step_count,
                    "thinking": step_result.thinking,
                    "action": step_result.action,
                    "success": step_result.success,
                    "finished": step_result.finished,
                }

                yield "event: step\n"
                yield f"data: {json.dumps(event_data, ensure_ascii=False)}\n\n"

                if step_result.finished:
                    done_data = {
                        "type": "done",
                        "message": step_result.message,
                        "steps": agent.step_count,
                        "success": step_result.success,
                    }
                    yield "event: done\n"
                    yield f"data: {json.dumps(done_data, ensure_ascii=False)}\n\n"
                    break

                if agent.step_count >= agent.agent_config.max_steps:
                    done_data = {
                        "type": "done",
                        "message": "Max steps reached",
                        "steps": agent.step_count,
                        "success": step_result.success,
                    }
                    yield "event: done\n"
                    yield f"data: {json.dumps(done_data, ensure_ascii=False)}\n\n"
                    break

                step_result = agent.step()

            # 任务完成后重置
            agent.reset()

        except Exception as e:
            # 发送错误事件
            error_data = {
                "type": "error",
                "message": str(e),
            }
            yield "event: error\n"
            yield f"data: {json.dumps(error_data, ensure_ascii=False)}\n\n"

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",  # 禁用 nginx 缓冲
        },
    )


@app.get("/api/status", response_model=StatusResponse)
def get_status(device_id: str | None = None) -> StatusResponse:
    """获取 Agent 状态和版本信息（多设备支持）。"""
    global agents

    if device_id is None:
        # 返回全局状态（兼容旧版）
        return StatusResponse(
            version=__version__,
            initialized=len(agents) > 0,
            step_count=0,
        )

    # 返回特定设备状态
    if device_id not in agents:
        return StatusResponse(
            version=__version__,
            initialized=False,
            step_count=0,
        )

    agent = agents[device_id]
    return StatusResponse(
        version=__version__,
        initialized=True,
        step_count=agent.step_count,
    )


@app.post("/api/reset")
def reset_agent(request: ResetRequest) -> dict:
    """重置 Agent 状态（多设备支持）。"""
    global agents, agent_configs

    device_id = request.device_id

    if device_id not in agents:
        raise HTTPException(status_code=404, detail=f"Device {device_id} not found")

    agent = agents[device_id]
    agent.reset()

    # 可选：使用缓存配置重新初始化
    if device_id in agent_configs:
        model_config, agent_config = agent_configs[device_id]
        agents[device_id] = PhoneAgent(
            model_config=model_config,
            agent_config=agent_config,
            takeover_callback=_non_blocking_takeover,
        )

    return {
        "success": True,
        "device_id": device_id,
        "message": f"Agent reset for device {device_id}",
    }


class DeviceListResponse(BaseModel):
    devices: list[dict]


@app.get("/api/devices", response_model=DeviceListResponse)
def list_devices() -> DeviceListResponse:
    """列出所有 ADB 设备。"""
    from phone_agent.adb import list_devices as adb_list

    global agents

    adb_devices = adb_list()

    return DeviceListResponse(
        devices=[
            {
                "id": d.device_id,
                "model": d.model or "Unknown",
                "status": d.status,
                "connection_type": d.connection_type.value,
                "is_initialized": d.device_id in agents,
            }
            for d in adb_devices
        ]
    )


@app.post("/api/video/reset")
async def reset_video_stream(device_id: str | None = None) -> dict:
    """Reset video stream (cleanup scrcpy server，多设备支持)."""
    global scrcpy_streamers, scrcpy_locks

    if device_id:
        # 重置特定设备的流
        if device_id in scrcpy_locks:
            async with scrcpy_locks[device_id]:
                if device_id in scrcpy_streamers:
                    print(f"[video/reset] Stopping streamer for device {device_id}")
                    scrcpy_streamers[device_id].stop()
                    del scrcpy_streamers[device_id]
                    print(f"[video/reset] Streamer reset for device {device_id}")
                    return {"success": True, "message": f"Video stream reset for device {device_id}"}
                else:
                    return {"success": True, "message": f"No active video stream for device {device_id}"}
        else:
            return {"success": True, "message": f"No video stream for device {device_id}"}
    else:
        # 重置所有设备的流
        device_ids = list(scrcpy_streamers.keys())
        for dev_id in device_ids:
            if dev_id in scrcpy_locks:
                async with scrcpy_locks[dev_id]:
                    if dev_id in scrcpy_streamers:
                        scrcpy_streamers[dev_id].stop()
                        del scrcpy_streamers[dev_id]
        print("[video/reset] All streamers reset")
        return {"success": True, "message": "All video streams reset"}


@app.post("/api/screenshot", response_model=ScreenshotResponse)
def take_screenshot(request: ScreenshotRequest) -> ScreenshotResponse:
    """获取设备截图。此操作无副作用，不影响 PhoneAgent 运行。"""
    try:
        screenshot = capture_screenshot(device_id=request.device_id)
        return ScreenshotResponse(
            success=True,
            image=screenshot.base64_data,
            width=screenshot.width,
            height=screenshot.height,
            is_sensitive=screenshot.is_sensitive,
        )
    except Exception as e:
        return ScreenshotResponse(
            success=False,
            image="",
            width=0,
            height=0,
            is_sensitive=False,
            error=str(e),
        )


@app.post("/api/control/tap", response_model=TapResponse)
def control_tap(request: TapRequest) -> TapResponse:
    """Execute tap at specified device coordinates."""
    try:
        from phone_agent.adb import tap

        tap(
            x=request.x,
            y=request.y,
            device_id=request.device_id,
            delay=request.delay
        )

        return TapResponse(success=True)
    except Exception as e:
        return TapResponse(success=False, error=str(e))


@app.post("/api/control/swipe", response_model=SwipeResponse)
def control_swipe(request: SwipeRequest) -> SwipeResponse:
    """Execute swipe from start to end coordinates."""
    try:
        from phone_agent.adb import swipe

        swipe(
            start_x=request.start_x,
            start_y=request.start_y,
            end_x=request.end_x,
            end_y=request.end_y,
            duration_ms=request.duration_ms,
            device_id=request.device_id,
            delay=request.delay
        )

        return SwipeResponse(success=True)
    except Exception as e:
        return SwipeResponse(success=False, error=str(e))


@app.post("/api/control/touch/down", response_model=TouchDownResponse)
def control_touch_down(request: TouchDownRequest) -> TouchDownResponse:
    """Send touch DOWN event at specified device coordinates."""
    try:
        from AutoGLM_GUI.adb_plus import touch_down

        touch_down(
            x=request.x,
            y=request.y,
            device_id=request.device_id,
            delay=request.delay
        )

        return TouchDownResponse(success=True)
    except Exception as e:
        return TouchDownResponse(success=False, error=str(e))


@app.post("/api/control/touch/move", response_model=TouchMoveResponse)
def control_touch_move(request: TouchMoveRequest) -> TouchMoveResponse:
    """Send touch MOVE event at specified device coordinates."""
    try:
        from AutoGLM_GUI.adb_plus import touch_move

        touch_move(
            x=request.x,
            y=request.y,
            device_id=request.device_id,
            delay=request.delay
        )

        return TouchMoveResponse(success=True)
    except Exception as e:
        return TouchMoveResponse(success=False, error=str(e))


@app.post("/api/control/touch/up", response_model=TouchUpResponse)
def control_touch_up(request: TouchUpRequest) -> TouchUpResponse:
    """Send touch UP event at specified device coordinates."""
    try:
        from AutoGLM_GUI.adb_plus import touch_up

        touch_up(
            x=request.x,
            y=request.y,
            device_id=request.device_id,
            delay=request.delay
        )

        return TouchUpResponse(success=True)
    except Exception as e:
        return TouchUpResponse(success=False, error=str(e))


@app.websocket("/api/video/stream")
async def video_stream_ws(websocket: WebSocket, device_id: str | None = None):
    """Stream real-time H.264 video from scrcpy server via WebSocket（多设备支持）."""
    global scrcpy_streamers, scrcpy_locks

    await websocket.accept()

    if not device_id:
        await websocket.send_json({"error": "device_id is required"})
        return

    print(f"[video/stream] WebSocket connection for device {device_id}")

    # 为设备创建锁（如果不存在）
    if device_id not in scrcpy_locks:
        scrcpy_locks[device_id] = asyncio.Lock()

    # 使用设备级别的锁
    async with scrcpy_locks[device_id]:
        # Reuse existing streamer if available
        if device_id not in scrcpy_streamers:
            print(f"[video/stream] Creating streamer for device {device_id}")
            scrcpy_streamers[device_id] = ScrcpyStreamer(
                device_id=device_id, max_size=1280, bit_rate=4_000_000
            )

            try:
                print(f"[video/stream] Starting scrcpy server for device {device_id}")
                await scrcpy_streamers[device_id].start()
                print(f"[video/stream] Scrcpy server started for device {device_id}")
            except Exception as e:
                import traceback

                print(f"[video/stream] Failed to start streamer: {e}")
                print(f"[video/stream] Traceback:\n{traceback.format_exc()}")
                scrcpy_streamers[device_id].stop()
                del scrcpy_streamers[device_id]
                try:
                    await websocket.send_json({"error": str(e)})
                except Exception:
                    pass
                return
        else:
            print(f"[video/stream] Reusing streamer for device {device_id}")

            # Send ONLY SPS/PPS (not IDR) to initialize decoder
            streamer = scrcpy_streamers[device_id]
            if streamer.cached_sps and streamer.cached_pps:
                init_data = streamer.cached_sps + streamer.cached_pps
                await websocket.send_bytes(init_data)
                print(f"[video/stream] Sent SPS/PPS for device {device_id}")
            else:
                print(f"[video/stream] Warning: No cached SPS/PPS for device {device_id}")

    # 获取当前设备的 streamer
    streamer = scrcpy_streamers[device_id]

    # Stream H.264 data to client
    stream_failed = False
    try:
        chunk_count = 0
        while True:
            try:
                h264_chunk = await streamer.read_h264_chunk()
                await websocket.send_bytes(h264_chunk)
                chunk_count += 1
                if chunk_count % 100 == 0:
                    print(f"[video/stream] Device {device_id}: Sent {chunk_count} chunks")
            except ConnectionError as e:
                print(f"[video/stream] Device {device_id}: Connection error: {e}")
                stream_failed = True
                try:
                    await websocket.send_json({"error": f"Stream error: {str(e)}"})
                except Exception:
                    pass
                break

    except WebSocketDisconnect:
        print(f"[video/stream] Device {device_id}: Client disconnected")
    except Exception as e:
        import traceback

        print(f"[video/stream] Device {device_id}: Error: {e}")
        print(f"[video/stream] Traceback:\n{traceback.format_exc()}")
        stream_failed = True
        try:
            await websocket.send_json({"error": str(e)})
        except Exception:
            pass

    # Reset device streamer if stream failed
    if stream_failed:
        async with scrcpy_locks[device_id]:
            if device_id in scrcpy_streamers:
                print(f"[video/stream] Resetting streamer for device {device_id}")
                scrcpy_streamers[device_id].stop()
                del scrcpy_streamers[device_id]

    print(f"[video/stream] Device {device_id}: Stream ended")


# 静态文件托管 - 使用包内资源定位
def _get_static_dir() -> Path | None:
    """获取静态文件目录路径。"""
    try:
        # 尝试从包内资源获取
        static_dir = files("AutoGLM_GUI").joinpath("static")
        if hasattr(static_dir, "_path"):
            # Traversable 对象
            path = Path(str(static_dir))
            if path.exists():
                return path
        # 直接转换为 Path
        path = Path(str(static_dir))
        if path.exists():
            return path
    except (TypeError, FileNotFoundError):
        pass

    return None


STATIC_DIR = _get_static_dir()

if STATIC_DIR is not None and STATIC_DIR.exists():
    # 托管静态资源
    assets_dir = STATIC_DIR / "assets"
    if assets_dir.exists():
        app.mount("/assets", StaticFiles(directory=assets_dir), name="assets")

    # 所有非 API 路由返回 index.html (支持前端路由)
    @app.get("/{full_path:path}")
    async def serve_spa(full_path: str) -> FileResponse:
        """Serve the SPA for all non-API routes."""
        # 如果请求的是具体文件且存在，则返回该文件
        file_path = STATIC_DIR / full_path
        if file_path.is_file():
            return FileResponse(file_path)
        # 否则返回 index.html (支持前端路由)
        return FileResponse(STATIC_DIR / "index.html")
