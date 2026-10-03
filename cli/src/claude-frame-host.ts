import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";

export type HostFrame = { pixels: Buffer; width: number; height: number };

export class FrameHost {
  readonly directory = fs.mkdtempSync(path.join(os.tmpdir(), "terminal-browser-claude-"));
  private server: net.Server | null = null;
  private control: net.Socket | null = null;
  private pane: string | null = null;
  private sockets = new Set<net.Socket>();
  onMessage: (message: unknown) => void = () => {};
  onFrame: (frame: HostFrame) => void = () => {};
  onDisconnect: () => void = () => {};
  onError: (error: Error) => void = () => {};

  constructor(readonly socketPath: string, private cell: () => [number, number]) {}

  listen(): void {
    if (process.platform !== "win32") fs.rmSync(this.socketPath, { force: true });
    this.server = net.createServer(socket => {
      this.sockets.add(socket);
      let buffer = "";
      let streamId: string | number | null = null;
      let streamPane: string | null = null;
      socket.setEncoding("utf8");
      socket.on("error", () => {});
      socket.on("close", () => {
        this.sockets.delete(socket);
        if (this.control === socket) {
          this.control = null;
          this.pane = null;
          this.onDisconnect();
        }
      });
      socket.on("data", (data: string) => {
        buffer += data;
        if (buffer.length > 1024 * 1024) { socket.destroy(); return; }
        let at: number;
        while ((at = buffer.indexOf("\n")) !== -1) {
          const line = buffer.slice(0, at);
          buffer = buffer.slice(at + 1);
          let message;
          try { message = JSON.parse(line); } catch { socket.destroy(); return; }
          if (!message || typeof message !== "object") { socket.destroy(); return; }
          if (streamId !== null) {
            try {
              if (streamPane === this.pane) this.readFrame(message);
            } catch (error) { this.onError(error instanceof Error ? error : new Error(String(error))); }
            socket.write(JSON.stringify({ id: streamId, result: { type: "pane_graphics_frame_ack" } }) + "\n");
          } else if (message.method === "pane.graphics.info") {
            const [width, height] = this.cell();
            socket.end(JSON.stringify({ id: message.id, result: { type: "pane_graphics_info", cell_width_px: width,
              cell_height_px: height, pane_visible: true, file_frame_directory: this.directory,
              file_frame_formats: ["rgba"], file_frame_transport: "direct-kitty" } }) + "\n");
          } else if (message.method === "pane.graphics.stream" && typeof message.params?.pane_id === "string") {
            streamId = message.id ?? "stream";
            streamPane = message.params.pane_id;
            socket.write(JSON.stringify({ id: streamId, result: { type: "ok" } }) + "\n");
          } else if (message.type === "join" && typeof message.pane === "string" && !this.control) {
            this.control = socket;
            this.pane = message.pane;
            this.onMessage(message);
          } else if (this.control === socket) {
            this.onMessage(message);
          } else socket.destroy();
        }
      });
    });
    this.server.on("error", error => this.onError(error));
    this.server.listen(this.socketPath);
  }

  private readFrame(message: { format?: string; image_width?: number; image_height?: number; file?: { path?: string } }): void {
    const width = message.image_width ?? 0, height = message.image_height ?? 0;
    if (message.format !== "rgba" || !Number.isInteger(width) || !Number.isInteger(height)
      || width < 1 || height < 1 || width * height > 40_000_000 || !message.file?.path) throw new Error("invalid browser frame header");
    const file = fs.realpathSync(message.file.path);
    if (path.dirname(file) !== fs.realpathSync(this.directory)) throw new Error("browser frame is outside its frame directory");
    const fd = fs.openSync(file, "r");
    try {
      const size = fs.fstatSync(fd);
      if (!size.isFile() || size.size !== width * height * 4) throw new Error("invalid browser frame size");
      const pixels = fs.readFileSync(fd);
      if (pixels.length !== width * height * 4) throw new Error("incomplete browser frame");
      this.onFrame({ pixels, width, height });
    } finally { fs.closeSync(fd); }
  }

  send(message: unknown): void {
    this.control?.write(JSON.stringify(message) + "\n");
  }

  stop(): void {
    for (const socket of this.sockets) socket.destroy();
    this.server?.close();
    if (process.platform !== "win32") fs.rmSync(this.socketPath, { force: true });
    const target = path.resolve(this.directory);
    if (path.dirname(target) !== path.resolve(os.tmpdir()) || !path.basename(target).startsWith("terminal-browser-claude-")) {
      throw new Error("invalid frame cleanup directory");
    }
    fs.rmSync(target, { recursive: true, force: true });
  }
}
