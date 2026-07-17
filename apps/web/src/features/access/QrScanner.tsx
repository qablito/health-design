import { useEffect, useRef, useState } from "react";

type BarcodeDetectorInstance = {
  detect(source: ImageBitmapSource): Promise<Array<{ rawValue?: string }>>;
};

type BarcodeDetectorConstructor = new (options: {
  formats: string[];
}) => BarcodeDetectorInstance;

type QrScannerProps = {
  disabled?: boolean;
  onValue: (value: string) => void;
};

export function QrScanner({ disabled = false, onValue }: QrScannerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [active, setActive] = useState(false);
  const [message, setMessage] = useState<string>();

  useEffect(() => {
    if (!active) return;
    const video = videoRef.current;
    const Detector = (
      globalThis as typeof globalThis & {
        BarcodeDetector?: BarcodeDetectorConstructor;
      }
    ).BarcodeDetector;
    if (!video || !Detector || !navigator.mediaDevices?.getUserMedia) {
      setMessage(
        "Este navegador no permite escanear directamente. Introduce el código QR en el campo inferior.",
      );
      setActive(false);
      return;
    }

    let animationFrame = 0;
    let stopped = false;
    let stream: MediaStream | undefined;
    const detector = new Detector({ formats: ["qr_code"] });
    const stop = () => {
      stopped = true;
      cancelAnimationFrame(animationFrame);
      stream?.getTracks().forEach((track) => track.stop());
      if (video.srcObject) video.srcObject = null;
    };
    const scan = async () => {
      if (stopped) return;
      if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
        try {
          const [result] = await detector.detect(video);
          if (result?.rawValue) {
            onValue(result.rawValue);
            setMessage("QR leído. Comprueba el dispositivo antes de vincularlo.");
            setActive(false);
            stop();
            return;
          }
        } catch {
          setMessage("No se ha podido leer el QR. Acércalo y vuelve a intentarlo.");
        }
      }
      animationFrame = requestAnimationFrame(() => void scan());
    };

    void navigator.mediaDevices
      .getUserMedia({ video: { facingMode: { ideal: "environment" } } })
      .then(async (mediaStream) => {
        if (stopped) {
          mediaStream.getTracks().forEach((track) => track.stop());
          return;
        }
        stream = mediaStream;
        video.srcObject = mediaStream;
        await video.play();
        animationFrame = requestAnimationFrame(() => void scan());
      })
      .catch(() => {
        setMessage(
          "No se ha podido abrir la cámara. Puedes introducir el código manualmente.",
        );
        setActive(false);
      });

    return stop;
  }, [active, onValue]);

  return (
    <section className="qr-scanner" aria-label="Escáner QR">
      <button
        className="secondary-button"
        disabled={disabled}
        onClick={() => {
          setMessage(undefined);
          setActive((current) => !current);
        }}
        type="button"
      >
        {active ? "Cerrar cámara" : "Escanear con la cámara"}
      </button>
      {active ? (
        <video
          aria-label="Vista de la cámara para escanear el QR"
          className="qr-camera"
          muted
          playsInline
          ref={videoRef}
        />
      ) : null}
      {message ? <p className="field-help">{message}</p> : null}
    </section>
  );
}
