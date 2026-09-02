'use client';

import * as React from 'react';
import type { QueryKey } from '@tanstack/react-query';
import { ApiClientError } from '@/lib/api';
import { useAction } from '@/hooks/use-action';
import { Button } from './button';
import { Dialog, Modal } from './dialog';

/**
 * A modal wrapping a create-or-edit form.
 *
 * It exists so the twenty-odd screens that need one do not each re-implement
 * the same four things: submitting, showing the pending state, mapping the
 * API's field errors back onto the inputs, and closing on success. The caller
 * supplies the fields and the request; everything else is handled here.
 *
 * Field errors are surfaced through the render prop rather than a toast,
 * because a message that says which field is wrong belongs next to that field.
 */
export function FormModal<TValues, TResult>({
  open,
  onOpenChange,
  title,
  description,
  size = 'md',
  submitLabel = 'Save',
  values,
  isValid = true,
  submit,
  successMessage,
  invalidates,
  onSaved,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: React.ReactNode;
  description?: React.ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  submitLabel?: string;
  /** The current form values, passed straight to `submit`. */
  values: TValues;
  /** Blocks the submit button while the form is incomplete. */
  isValid?: boolean;
  submit: (values: TValues) => Promise<TResult>;
  successMessage: string | ((result: TResult) => string);
  invalidates?: QueryKey[];
  onSaved?: (result: TResult) => void;
  /** Rendered inside the modal body, given any per-field errors from the API. */
  children: (fieldErrors: Record<string, string>) => React.ReactNode;
}) {
  const [fieldErrors, setFieldErrors] = React.useState<Record<string, string>>({});

  const action = useAction({
    mutationFn: submit,
    successMessage,
    invalidates,
    onSuccess: (result) => {
      setFieldErrors({});
      onOpenChange(false);
      onSaved?.(result);
    },
    onError: (error: ApiClientError) => {
      setFieldErrors(error.isValidation ? error.byField : {});
    },
  });

  function handleOpenChange(next: boolean) {
    // Errors from a previous attempt should not greet the user when the form
    // is opened again.
    if (!next) setFieldErrors({});
    onOpenChange(next);
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <Modal
        size={size}
        title={title}
        description={description}
        footer={
          <>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => handleOpenChange(false)}
              disabled={action.isPending}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              variant="primary"
              loading={action.isPending}
              disabled={!isValid}
              onClick={() => action.mutate(values)}
            >
              {submitLabel}
            </Button>
          </>
        }
      >
        <form
          className="space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            if (isValid) action.mutate(values);
          }}
        >
          {children(fieldErrors)}
          {/* Lets Enter submit without a visible second button. */}
          <button type="submit" className="hidden" aria-hidden tabIndex={-1} />
        </form>
      </Modal>
    </Dialog>
  );
}
