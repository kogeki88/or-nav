import type { LocalAudioTrack, RemoteAudioTrack } from "livekit-client";

export class LiveKitAudioVisualizer {
  private canvasCtx: CanvasRenderingContext2D | null = null;
  private animationFrameId: number | null = null;
  private track: LocalAudioTrack | RemoteAudioTrack | null = null;

  constructor(private canvas: HTMLCanvasElement) {
    this.canvasCtx = canvas.getContext('2d');
  }

  start(track: LocalAudioTrack | RemoteAudioTrack) {
    this.track = track;
    this.track.on('muted', this.handleMuted);

    const draw = () => {
      if (this.canvasCtx) {
        this.canvasCtx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        // Draw visualizer bars based on audio track frequencies
      }
      this.animationFrameId = requestAnimationFrame(draw);
    };
    this.animationFrameId = requestAnimationFrame(draw);
  }

  private handleMuted = () => {
    this.stop();
  };

  stop() {
    if (this.animationFrameId !== null) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }
  }

  disconnect() {
    if (this.track) {
      this.track.off('muted', this.handleMuted);
      this.track = null;
    }
    this.stop();
  }

  dispose() {
    this.disconnect();
    this.canvasCtx = null;
  }
}
