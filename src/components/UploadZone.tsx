import { useRef, useState } from "react";
import { useStore } from "../state/store";

export function UploadZone() {
  const ingest = useStore((s) => s.ingest);
  const inputRef = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);

  const onFiles = (files: FileList | null) => {
    const file = files?.[0];
    if (file) void ingest(file);
  };

  return (
    <div
      className={`dropzone${over ? " over" : ""}`}
      onClick={() => inputRef.current?.click()}
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        onFiles(e.dataTransfer.files);
      }}
      role="button"
      aria-label="Upload a portfolio PDF"
    >
      <div className="icon">
        <svg width="26" height="26" viewBox="0 0 24 24" fill="none" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 16V4m0 0-4 4m4-4 4 4" />
          <path d="M4 16.5V19a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2.5" />
        </svg>
      </div>
      <h3>Drop your portfolio here</h3>
      <p>or click to browse — analysis starts instantly, right in your browser</p>
      <div className="formats">
        <span>PDF · A3</span>
        <span>≤ 12 pages</span>
        <span>never stored</span>
      </div>
      <input
        ref={inputRef}
        type="file"
        accept="application/pdf,.pdf"
        hidden
        onChange={(e) => onFiles(e.target.files)}
      />
    </div>
  );
}
