/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        sa: {
          green: '#007A4D',
          gold: '#FFB612',
          red: '#DE3831',
          blue: '#002395',
          black: '#000000',
          white: '#FFFFFF',
        },
        background: "var(--background)",
        foreground: "var(--foreground)",
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
      boxShadow: {
        'sa': '0 4px 6px -1px rgba(0, 122, 77, 0.1), 0 2px 4px -1px rgba(0, 122, 77, 0.06)',
        'sa-lg': '0 10px 15px -3px rgba(0, 122, 77, 0.1), 0 4px 6px -2px rgba(0, 122, 77, 0.05)',
        'emergency': '0 0 20px rgba(222, 56, 49, 0.5)',
      },
      animation: {
        'emergency-flash': 'emergency-flash 0.5s ease-in-out infinite',
        'emergency-pulse': 'pulse-emergency 2s ease-in-out infinite',
      },
      keyframes: {
        'emergency-flash': {
          '0%, 100%': { backgroundColor: '#DE3831', opacity: '1' },
          '50%': { backgroundColor: '#FF6B6B', opacity: '0.9' },
        },
        'pulse-emergency': {
          '0%, 100%': { transform: 'scale(1)', boxShadow: '0 0 0 0 rgba(222, 56, 49, 0.7)' },
          '50%': { transform: 'scale(1.05)', boxShadow: '0 0 0 20px rgba(222, 56, 49, 0)' },
        },
      },
    },
  },
  plugins: [],
};

