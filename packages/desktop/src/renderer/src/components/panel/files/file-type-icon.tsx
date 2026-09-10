import { FileIcon } from "react-material-vscode-icons";

interface FileTypeIconProps {
  name: string;
  className?: string;
  size?: number;
}

export function FileTypeIcon({ name, className = "file-type-icon", size = 16 }: FileTypeIconProps) {
  return (
    <span className={className} aria-hidden="true">
      <FileIcon fileName={name} size={size} />
    </span>
  );
}
