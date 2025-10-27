import { useState } from "react";

export function Select({ value, onValueChange, children }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="relative inline-block">
      <div
        onClick={() => setOpen(!open)}
        className="border border-gray-300 bg-white rounded-lg px-3 py-2 w-40 cursor-pointer flex justify-between items-center"
      >
        {value || "Selecione..."}
        <span className="text-gray-500 ml-2">{open ? "▲" : "▼"}</span>
      </div>
      {open && (
        <div className="absolute mt-1 w-full bg-white border border-gray-300 rounded-lg shadow z-10">
          {children &&
            children.map((child, index) => (
              <div
                key={index}
                onClick={() => {
                  onValueChange(child.props.value);
                  setOpen(false);
                }}
                className="px-3 py-2 hover:bg-blue-50 cursor-pointer"
              >
                {child.props.children}
              </div>
            ))}
        </div>
      )}
    </div>
  );
}

export function SelectTrigger({ children }) {
  return <>{children}</>;
}

export function SelectValue({ placeholder }) {
  return <span className="text-gray-500">{placeholder}</span>;
}

export function SelectContent({ children }) {
  return <>{children}</>;
}

export function SelectItem({ value, children }) {
  return <div value={value}>{children}</div>;
}
