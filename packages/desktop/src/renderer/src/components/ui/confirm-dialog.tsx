import { Button } from "./button.tsx";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from "./dialog.tsx";

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  description: string;
  confirmLabel?: string;
  onOpenChange(open: boolean): void;
  onConfirm(): void;
}

/** shadcn 风格的破坏性操作确认框。 */
export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = "删除",
  onOpenChange,
  onConfirm,
}: ConfirmDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="gap-3 sm:max-w-md">
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription>{description}</DialogDescription>
        <div className="mt-3 flex justify-end gap-2">
          <DialogClose asChild>
            <Button variant="ghost">取消</Button>
          </DialogClose>
          <Button variant="destructive" onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
