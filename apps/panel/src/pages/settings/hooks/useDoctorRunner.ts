import { useState, useEffect, useCallback, useRef } from "react";
import { SSE } from "@rivonclaw/core/api-contract";
import { provisionDeps } from "../../../api/index.js";
import type { DoctorStatus } from "../settings-types.js";

export function useDoctorRunner() {
  const [depsInstalling, setDepsInstalling] = useState(false);
  const [doctorStatus, setDoctorStatus] = useState<DoctorStatus>("idle");
  const [doctorOutput, setDoctorOutput] = useState<string[]>([]);
  const [doctorExitCode, setDoctorExitCode] = useState<number | null>(null);
  const doctorOutputRef = useRef<HTMLPreElement>(null);
  const doctorSseRef = useRef<EventSource | null>(null);

  useEffect(() => {
    if (doctorOutputRef.current) {
      doctorOutputRef.current.scrollTop = doctorOutputRef.current.scrollHeight;
    }
  }, [doctorOutput]);

  useEffect(() => {
    return () => { doctorSseRef.current?.close(); };
  }, []);

  const handleInstallDeps = useCallback(async () => {
    setDepsInstalling(true);
    try {
      await provisionDeps();
    } catch (err) {
      console.error("Failed to trigger deps provisioner:", err);
    } finally {
      setDepsInstalling(false);
    }
  }, []);

  const runDoctor = useCallback((fix: boolean) => {
    doctorSseRef.current?.close();
    setDoctorStatus("running");
    setDoctorOutput([]);
    setDoctorExitCode(null);

    const sse = new EventSource(SSE["doctor.run"].path + (fix ? "?fix=true" : ""));
    doctorSseRef.current = sse;

    sse.onmessage = (e) => {
      const data = JSON.parse(e.data);
      if (data.type === "output") {
        setDoctorOutput(prev => [...prev, data.text]);
      } else if (data.type === "done") {
        setDoctorExitCode(data.exitCode);
        setDoctorStatus(data.exitCode === 0 ? "done" : "error");
        sse.close();
        doctorSseRef.current = null;
      } else if (data.type === "error") {
        setDoctorOutput(prev => [...prev, `ERROR: ${data.message}`]);
        setDoctorStatus("error");
        sse.close();
        doctorSseRef.current = null;
      }
    };

    sse.onerror = () => {
      setDoctorStatus("error");
      sse.close();
      doctorSseRef.current = null;
    };
  }, []);

  return {
    depsInstalling,
    doctorStatus,
    doctorOutput,
    doctorExitCode,
    doctorOutputRef,
    handleInstallDeps,
    runDoctor,
  };
}
