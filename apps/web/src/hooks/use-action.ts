'use client';

import { useMutation, useQueryClient, type QueryKey } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ApiClientError } from '@/lib/api';

/**
 * A mutation that reports itself.
 *
 * Success shows a confirmation and invalidates the affected queries; failure
 * shows the server's own message rather than a generic one, because the API
 * already explains itself well ("Only 8 PCS remain in stock").
 */
export function useAction<TVariables, TData>(options: {
  mutationFn: (variables: TVariables) => Promise<TData>;
  successMessage?: string | ((data: TData) => string);
  /** Query keys to invalidate once the mutation lands. */
  invalidates?: QueryKey[];
  onSuccess?: (data: TData, variables: TVariables) => void;
  onError?: (error: ApiClientError) => void;
}) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: options.mutationFn,
    onSuccess: (data, variables) => {
      if (options.successMessage) {
        toast.success(
          typeof options.successMessage === 'function'
            ? options.successMessage(data)
            : options.successMessage,
        );
      }
      for (const key of options.invalidates ?? []) {
        void queryClient.invalidateQueries({ queryKey: key });
      }
      options.onSuccess?.(data, variables);
    },
    onError: (error) => {
      if (error instanceof ApiClientError) {
        // Validation errors belong on the fields, so the caller handles those;
        // everything else is worth a toast.
        if (!error.isValidation || error.fieldErrors.length === 0) {
          toast.error(error.message);
        }
        options.onError?.(error);
        return;
      }
      toast.error('Something went wrong. Please try again.');
    },
  });
}
