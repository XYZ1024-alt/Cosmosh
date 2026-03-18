import React from 'react';

import { createEntityIconNode, EntityVisual } from '../../lib/entity-visuals';
import { t } from '../../lib/i18n';
import { Button } from '../ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../ui/dialog';
import { Input } from '../ui/input';
import EntityIcon from './EntityIcon';
import EntityVisualPicker from './EntityVisualPicker';

type CreateFolderDialogProps = {
  open: boolean;
  folderName: string;
  visual: EntityVisual;
  isSubmitting: boolean;
  onOpenChange: (open: boolean) => void;
  onFolderNameChange: (value: string) => void;
  onVisualChange: (nextVisual: EntityVisual) => void;
  onSubmit: () => void;
};

const CreateFolderDialog: React.FC<CreateFolderDialogProps> = ({
  open,
  folderName,
  visual,
  isSubmitting,
  onOpenChange,
  onFolderNameChange,
  onVisualChange,
  onSubmit,
}) => {
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('home.quickAddFolder')}</DialogTitle>
          <DialogDescription>{t('home.dialogCreateFolderDescription')}</DialogDescription>
        </DialogHeader>

        <div className="flex items-center gap-2">
          <EntityVisualPicker
            visual={visual}
            label={t('home.iconSearchPlaceholder')}
            onChange={onVisualChange}
          >
            <Button
              type="button"
              variant="ghost"
              className="h-9 w-9 shrink-0 rounded-sm-2 p-0"
              aria-label={t('home.editVisual')}
            >
              <EntityIcon
                icon={createEntityIconNode(visual, t('home.editVisual'))}
                tone="flat"
              />
            </Button>
          </EntityVisualPicker>
          <Input
            value={folderName}
            placeholder={t('home.folderNamePlaceholder')}
            onChange={(event) => onFolderNameChange(event.target.value)}
          />
        </div>

        <DialogFooter>
          <Button
            variant="ghost"
            onClick={() => onOpenChange(false)}
          >
            {t('home.actionCancel')}
          </Button>
          <Button
            disabled={isSubmitting}
            onClick={onSubmit}
          >
            {t('home.actionCreate')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default CreateFolderDialog;
