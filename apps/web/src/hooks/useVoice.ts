import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { voiceService } from '@/services/voice.service';

export function useVoiceLogs(limit = 10) {
  return useQuery({
    queryKey: ['voice', 'logs', limit],
    queryFn: () => voiceService.getLogs(limit),
  });
}

export function useVoiceSession() {
  const queryClient = useQueryClient();

  const startMutation = useMutation({
    mutationFn: () => voiceService.startSession(),
  });

  const respondMutation = useMutation({
    mutationFn: ({ sessionId, message }: { sessionId: string; message: string }) =>
      voiceService.respondToSession(sessionId, message),
  });

  const completeMutation = useMutation({
    mutationFn: (sessionId: string) => voiceService.completeSession(sessionId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['voice', 'logs'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
    },
  });

  return {
    startSession: startMutation.mutateAsync,
    respondToSession: respondMutation.mutateAsync,
    completeSession: completeMutation.mutateAsync,
    isStarting: startMutation.isPending,
    isResponding: respondMutation.isPending,
    isCompleting: completeMutation.isPending,
  };
}
