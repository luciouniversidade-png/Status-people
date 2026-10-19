"use client";
import type { SelectHTMLAttributes, InputHTMLAttributes } from "react";

/** Campo que envia o próprio formulário ao mudar (o botão "Aplicar" continua lá para quem navega sem JavaScript). */
export function SelectAuto(p: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...p} onChange={e => { p.onChange?.(e); e.currentTarget.form?.requestSubmit(); }} />;
}
export function InputAuto(p: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...p} onChange={e => { p.onChange?.(e); if (e.currentTarget.value) e.currentTarget.form?.requestSubmit(); }} />;
}
