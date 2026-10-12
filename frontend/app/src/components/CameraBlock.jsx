import { useRef, useState, useEffect } from 'react';

export default function CameraBlock({ onCapturePhoto, onCaptureVideo, onClose }) {
    const videoRef = useRef(null);
    const canvasRef = useRef(null);
    const mediaRecorderRef = useRef(null);
    const chunksRef = useRef([]);
    const streamRef = useRef(null);
    
    const [error, setError] = useState('');
    const [isRecording, setIsRecording] = useState(false);
    const [stream, setStream] = useState(null);

    useEffect(() => {
        let cancelled = false;
        async function startCamera() {
            try {
                const s = await navigator.mediaDevices.getUserMedia({
                    video: {
                        facingMode: 'environment',
                        width: { ideal: 1920 },
                        height: { ideal: 1080 }
                    },
                    audio: true
                });
                // Окно закрыли, пока камера запрашивалась — сразу освобождаем поток
                if (cancelled) {
                    s.getTracks().forEach(track => track.stop());
                    return;
                }
                streamRef.current = s;
                setStream(s);
                if (videoRef.current) videoRef.current.srcObject = s;
            } catch (err) {
                setError('Нет доступа к камере/микрофону.');
            }
        }
        startCamera();
        return () => {
            cancelled = true;
            // Берём поток из ref, а не из state: в замыкании state здесь всегда null
            if (streamRef.current) {
                streamRef.current.getTracks().forEach(track => track.stop());
                streamRef.current = null;
            }
        };
    }, []);

    const takePhoto = () => {
        if (videoRef.current && canvasRef.current) {
            const video = videoRef.current;
            const canvas = canvasRef.current;
            canvas.width = video.videoWidth;
            canvas.height = video.videoHeight;
            canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
            onCapturePhoto(canvas.toDataURL('image/jpeg', 0.95));
        }
    };

    const startRecording = () => {
        if (!stream) return;
        chunksRef.current = [];
        const recorder = new MediaRecorder(stream);
        recorder.ondataavailable = e => { if (e.data.size > 0) chunksRef.current.push(e.data); };
        recorder.onstop = () => {
            const blob = new Blob(chunksRef.current, { type: 'video/mp4' });
            onCaptureVideo(URL.createObjectURL(blob)); 
        };
        recorder.start();
        mediaRecorderRef.current = recorder;
        setIsRecording(true);
    };

    const stopRecording = () => {
        if (mediaRecorderRef.current) {
            mediaRecorderRef.current.stop();
            setIsRecording(false);
        }
    };

    return (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.9)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', zIndex: 9999 }}>
            {error ? <div style={{ color: '#d63c3c', padding: '20px', background: '#fff', borderRadius: '8px' }}>{error}</div> : (
                <div style={{ position: 'relative', width: '100%', maxWidth: '500px' }}>
                    <video ref={videoRef} autoPlay playsInline muted style={{ width: '100%', borderRadius: '8px', background: '#000' }}></video>
                    {isRecording && <div style={{ position: 'absolute', top: 10, right: 10, background: 'red', color: 'white', padding: '5px 10px', borderRadius: '20px', fontWeight: 'bold', animation: 'blink 1s infinite' }}>REC</div>}
                </div>
            )}
            <canvas ref={canvasRef} style={{ display: 'none' }}></canvas>

            <div style={{ marginTop: '20px', display: 'flex', gap: '10px', flexWrap: 'wrap', justifyContent: 'center' }}>
                {!isRecording && <button onClick={takePhoto} style={{ padding: '12px 20px', background: '#26875a', color: '#fff', border: 'none', borderRadius: '30px', fontWeight: 'bold', cursor: 'pointer' }}>📸 Фото</button>}
                
                {isRecording ? (
                    <button onClick={stopRecording} style={{ padding: '12px 20px', background: '#d63c3c', color: '#fff', border: 'none', borderRadius: '30px', fontWeight: 'bold', cursor: 'pointer' }}>⏹️ Остановить</button>
                ) : (
                    <button onClick={startRecording} style={{ padding: '12px 20px', background: '#d63c3c', color: '#fff', border: 'none', borderRadius: '30px', fontWeight: 'bold', cursor: 'pointer' }}>🎥 Видео</button>
                )}
                
                {!isRecording && <button onClick={onClose} style={{ padding: '12px 20px', background: '#6e635b', color: '#fff', border: 'none', borderRadius: '30px', fontWeight: 'bold', cursor: 'pointer' }}>Отмена</button>}
            </div>
            <style>{`@keyframes blink { 50% { opacity: 0; } }`}</style>
        </div>
    );
}