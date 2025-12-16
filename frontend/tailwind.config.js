import colors from 'tailwindcss/colors';

/** @type {import('tailwindcss').Config} */
export default {
    content: [
        "./index.html",
        "./src/**/*.{js,ts,jsx,tsx}",
    ],
    theme: {
        extend: {
            colors: {
                brand: colors.indigo,
                primary: {
                    DEFAULT: '#6366f1',
                    hover: '#4f46e5',
                },
                secondary: '#8b5cf6',
            },
            fontFamily: {
                serif: ['Georgia', 'Cambria', '"Times New Roman"', 'Times', 'serif'],
            },
        },
    },
    plugins: [],
}
