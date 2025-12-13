"""Media routes: screenshot, video stream, stream reset."""

import asyncio

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from AutoGLM_GUI.adb_plus import capture_screenshot
from AutoGLM_GUI.schemas import ScreenshotRequest, ScreenshotResponse
from AutoGLM_GUI.scrcpy_stream import ScrcpyStreamer
from AutoGLM_GUI.state import scrcpy_locks, scrcpy_streamers

router = APIRouter()


@router.post("/api/video/reset")
async def reset_video_stream(device_id: str | None = None) -> dict:
    """Reset video stream (cleanup scrcpy server，多设备支持)."""
    if device_id:
        if device_id in scrcpy_locks:
            async with scrcpy_locks[device_id]:
                if device_id in scrcpy_streamers:
                    print(f"[video/reset] Stopping streamer for device {device_id}")
                    scrcpy_streamers[device_id].stop()
                    del scrcpy_streamers[device_id]
                    print(f"[video/reset] Streamer reset for device {device_id}")
                    return {
                        "success": True,
                        "message": f"Video stream reset for device {device_id}",
                    }
                return {
                    "success": True,
                    "message": f"No active video stream for device {device_id}",
                }
        return {"success": True, "message": f"No video stream for device {device_id}"}

    device_ids = list(scrcpy_streamers.keys())
    for dev_id in device_ids:
        if dev_id in scrcpy_locks:
            async with scrcpy_locks[dev_id]:
                if dev_id in scrcpy_streamers:
                    scrcpy_streamers[dev_id].stop()
                    del scrcpy_streamers[dev_id]
    print("[video/reset] All streamers reset")
    return {"success": True, "message": "All video streams reset"}


@router.post("/api/screenshot", response_model=ScreenshotResponse)
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


@router.websocket("/api/video/stream")
async def video_stream_ws(websocket: WebSocket, device_id: str | None = None):
    """Stream real-time H.264 video from scrcpy server via WebSocket（多设备支持）."""
    await websocket.accept()

    if not device_id:
        await websocket.send_json({"error": "device_id is required"})
        return

    print(f"[video/stream] WebSocket connection for device {device_id}")

    if device_id not in scrcpy_locks:
        scrcpy_locks[device_id] = asyncio.Lock()

    async with scrcpy_locks[device_id]:
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

            streamer = scrcpy_streamers[device_id]
            if streamer.cached_sps and streamer.cached_pps:
                init_data = streamer.cached_sps + streamer.cached_pps
                await websocket.send_bytes(init_data)
                print(f"[video/stream] Sent SPS/PPS for device {device_id}")
            else:
                print(
                    f"[video/stream] Warning: No cached SPS/PPS for device {device_id}"
                )

    streamer = scrcpy_streamers[device_id]

    stream_failed = False
    try:
        chunk_count = 0
        while True:
            try:
                h264_chunk = await streamer.read_h264_chunk()
                await websocket.send_bytes(h264_chunk)
                chunk_count += 1
                if chunk_count % 100 == 0:
                    print(
                        f"[video/stream] Device {device_id}: Sent {chunk_count} chunks"
                    )
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

    if stream_failed:
        async with scrcpy_locks[device_id]:
            if device_id in scrcpy_streamers:
                print(f"[video/stream] Resetting streamer for device {device_id}")
                scrcpy_streamers[device_id].stop()
                del scrcpy_streamers[device_id]

    print(f"[video/stream] Device {device_id}: Stream ended")
