import React, { useEffect, useRef, useState } from 'react';
import { Camera, RefreshCw, X, Check, AlertCircle, Sparkles, SwitchCamera } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { notify } from '@/components/ui/Toast';

interface CameraCaptureModalProps {
  open: boolean;
  onClose: () => void;
  onCapture: (file: File) => void;
  title?: string;
  subtitle?: string;
}

export const CameraCaptureModal: React.FC<CameraCaptureModalProps> = ({
  open,
  onClose,
  onCapture,
  title = 'Live Camera Capture',
  subtitle = 'Align document or pill package within the viewfinder and snap photo',
}) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [capturedBlob, setCapturedBlob] = useState<Blob | null>(null);
  const [capturedUrl, setCapturedUrl] = useState<string | null>(null);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [isInitializing, setIsInitializing] = useState(true);
  const [facingMode, setFacingMode] = useState<'user' | 'environment'>('environment');

  // Stop camera tracks cleanly
  const stopStream = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
  };

  // Start camera stream
  const startCamera = async (facing: 'user' | 'environment') => {
    stopStream();
    setCameraError(null);
    setIsInitializing(true);

    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error('Camera access API is not supported in this browser environment.');
      }

      let stream: MediaStream;
      try {
        // Try requested facingMode first
        stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: facing,
            width: { ideal: 1920, min: 640 },
            height: { ideal: 1080, min: 480 },
          },
          audio: false,
        });
      } catch {
        // Fallback to any available video device (e.g. laptop webcam)
        stream = await navigator.mediaDevices.getUserMedia({
          video: true,
          audio: false,
        });
      }

      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setIsInitializing(false);
    } catch (err: any) {
      setIsInitializing(false);
      const msg =
        err?.name === 'NotAllowedError' || err?.name === 'PermissionDeniedError'
          ? 'Camera permission was denied. Please allow camera access in your browser bar.'
          : err?.name === 'NotFoundError' || err?.name === 'DevicesNotFoundError'
          ? 'No camera device found on this system.'
          : err?.message || 'Could not initialize live camera.';
      setCameraError(msg);
    }
  };

  useEffect(() => {
    if (open) {
      setCapturedBlob(null);
      setCapturedUrl(null);
      void startCamera(facingMode);
    } else {
      stopStream();
      if (capturedUrl) {
        URL.revokeObjectURL(capturedUrl);
        setCapturedUrl(null);
      }
    }

    return () => {
      stopStream();
      if (capturedUrl) {
        URL.revokeObjectURL(capturedUrl);
      }
    };
  }, [open, facingMode]);

  const handleSnap = () => {
    if (!videoRef.current) return;
    const video = videoRef.current;
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth || 1280;
    canvas.height = video.videoHeight || 720;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    canvas.toBlob(
      (blob) => {
        if (!blob) {
          notify.error('Failed to capture frame from camera.');
          return;
        }
        setCapturedBlob(blob);
        const url = URL.createObjectURL(blob);
        setCapturedUrl(url);
        stopStream();
      },
      'image/jpeg',
      0.95,
    );
  };

  const handleRetake = () => {
    if (capturedUrl) {
      URL.revokeObjectURL(capturedUrl);
      setCapturedUrl(null);
    }
    setCapturedBlob(null);
    void startCamera(facingMode);
  };

  const handleConfirm = () => {
    if (!capturedBlob) return;
    const file = new File([capturedBlob], `camera-capture-${Date.now()}.jpg`, {
      type: 'image/jpeg',
    });
    onCapture(file);
    onClose();
  };

  const toggleFacingMode = () => {
    const nextMode = facingMode === 'environment' ? 'user' : 'environment';
    setFacingMode(nextMode);
  };

  return (
    <Modal
      open={open}
      onClose={() => {
        stopStream();
        onClose();
      }}
      title={title}
      className="max-w-xl"
    >
      <div className="space-y-4 pt-2">
        <p className="text-xs text-text-muted">{subtitle}</p>

        {/* Viewfinder Window */}
        <div className="relative aspect-[4/3] w-full overflow-hidden rounded-2xl bg-black border border-slate-800 shadow-2xl flex items-center justify-center">
          {cameraError ? (
            <div className="p-6 text-center text-rose-400 space-y-3">
              <AlertCircle className="h-10 w-10 mx-auto text-rose-500" />
              <p className="text-sm font-semibold">{cameraError}</p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => void startCamera(facingMode)}
                className="mt-2 text-xs"
              >
                <RefreshCw className="h-3.5 w-3.5 mr-1.5" /> Try Again
              </Button>
            </div>
          ) : capturedUrl ? (
            <img
              src={capturedUrl}
              alt="Captured Frame"
              className="h-full w-full object-contain"
            />
          ) : (
            <>
              <video
                ref={videoRef}
                playsInline
                muted
                className="h-full w-full object-cover"
              />

              {/* HUD Framing Brackets */}
              <div className="pointer-events-none absolute inset-6 border border-brand-400/40 rounded-xl">
                <div className="absolute top-0 left-0 h-4 w-4 border-t-2 border-l-2 border-brand-400 -mt-0.5 -ml-0.5" />
                <div className="absolute top-0 right-0 h-4 w-4 border-t-2 border-r-2 border-brand-400 -mt-0.5 -mr-0.5" />
                <div className="absolute bottom-0 left-0 h-4 w-4 border-b-2 border-l-2 border-brand-400 -mb-0.5 -ml-0.5" />
                <div className="absolute bottom-0 right-0 h-4 w-4 border-b-2 border-r-2 border-brand-400 -mb-0.5 -mr-0.5" />
              </div>

              {/* Animated Scan Line */}
              <div className="pointer-events-none absolute inset-x-6 top-6 h-0.5 bg-gradient-to-r from-transparent via-brand-400 to-transparent shadow-[0_0_12px_rgba(59,130,246,0.8)] animate-[bounce_3s_infinite]" />

              {/* Switch Camera Button (if multiple cameras available) */}
              <button
                type="button"
                onClick={toggleFacingMode}
                className="absolute top-3 right-3 p-2.5 rounded-full bg-black/60 backdrop-blur-md text-white border border-white/20 hover:bg-black/80 transition-all shadow-md"
                title="Switch Camera (Front/Rear)"
              >
                <SwitchCamera className="h-4 w-4" />
              </button>
            </>
          )}

          {isInitializing && !cameraError && (
            <div className="absolute inset-0 bg-black/80 flex flex-col items-center justify-center space-y-2 text-white">
              <RefreshCw className="h-7 w-7 animate-spin text-brand-400" />
              <span className="text-xs font-semibold">Starting laptop webcam...</span>
            </div>
          )}
        </div>

        {/* Action Controls */}
        <div className="flex items-center justify-between pt-2">
          {capturedBlob ? (
            <>
              <Button
                type="button"
                variant="outline"
                onClick={handleRetake}
                className="text-xs"
              >
                <RefreshCw className="h-4 w-4 mr-1.5" /> Retake Photo
              </Button>
              <Button
                type="button"
                onClick={handleConfirm}
                className="bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs shadow-lg shadow-emerald-600/30"
              >
                <Check className="h-4 w-4 mr-1.5" /> Use This Photo
              </Button>
            </>
          ) : (
            <>
              <Button
                type="button"
                variant="ghost"
                onClick={() => {
                  stopStream();
                  onClose();
                }}
                className="text-xs text-text-muted"
              >
                Cancel
              </Button>
              <Button
                type="button"
                disabled={isInitializing || Boolean(cameraError)}
                onClick={handleSnap}
                className="bg-brand-600 hover:bg-brand-500 text-white font-bold text-xs px-6 py-2.5 rounded-xl shadow-lg shadow-brand-600/40 flex items-center gap-2"
              >
                <Camera className="h-4 w-4" /> Capture Photo
              </Button>
            </>
          )}
        </div>
      </div>
    </Modal>
  );
};
