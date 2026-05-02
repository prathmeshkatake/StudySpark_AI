// --- Global State ---
let currentTab = 'upload';
let generatedData = {
    summary: null,
    flashcards: null,
    quiz: null
};
let quizState = {
    currentQuestionIndex: 0,
    score: 0,
    userAnswers: []
};

// --- Initialization ---
document.addEventListener('DOMContentLoaded', () => {
    // Set initial active tab
    document.getElementById('nav-upload').classList.add('active');
    
    // Check local storage for app password
    const savedPwd = localStorage.getItem('app_password');
    if (savedPwd) {
        document.getElementById('app-password-input').value = savedPwd;
    }
    
    // Save password on change
    document.getElementById('app-password-input').addEventListener('change', (e) => {
        localStorage.setItem('app_password', e.target.value.trim());
    });
});

// --- UI Navigation ---
function switchTab(tabId) {
    // Update nav buttons
    document.querySelectorAll('.nav-btn').forEach(btn => {
        btn.classList.remove('active');
        // Reset styles for inactive
        if(btn.id !== `nav-${tabId}`) {
            btn.classList.add('text-slate-400');
            btn.classList.remove('text-brand-400', 'bg-brand-500/10');
        }
    });
    
    const activeBtn = document.getElementById(`nav-${tabId}`);
    activeBtn.classList.add('active', 'text-brand-400', 'bg-brand-500/10');
    activeBtn.classList.remove('text-slate-400');

    // Hide all tabs
    document.querySelectorAll('.tab-content').forEach(tab => {
        tab.classList.add('hidden');
        tab.classList.remove('block');
    });

    // Show selected tab
    const targetTab = document.getElementById(`tab-${tabId}`);
    targetTab.classList.remove('hidden');
    targetTab.classList.add('block');
    
    // Re-trigger animation
    targetTab.style.animation = 'none';
    targetTab.offsetHeight; // trigger reflow
    targetTab.style.animation = null;

    currentTab = tabId;
}

function togglePasswordVisibility() {
    const input = document.getElementById('app-password-input');
    const icon = document.getElementById('pwd-eye-icon');
    if (input.type === 'password') {
        input.type = 'text';
        icon.classList.replace('fa-eye', 'fa-eye-slash');
    } else {
        input.type = 'password';
        icon.classList.replace('fa-eye-slash', 'fa-eye');
    }
}

function toggleOverrideVisibility() {
    const input = document.getElementById('override-api-key');
    const icon = document.getElementById('override-eye-icon');
    if (input.type === 'password') {
        input.type = 'text';
        icon.classList.replace('fa-eye', 'fa-eye-slash');
    } else {
        input.type = 'password';
        icon.classList.replace('fa-eye-slash', 'fa-eye');
    }
}

function clearNotes() {
    document.getElementById('notes-input').value = '';
    showToast('Notes cleared');
}

function copyToClipboard(elementId) {
    const content = document.getElementById(elementId).innerText;
    navigator.clipboard.writeText(content).then(() => {
        showToast('Copied to clipboard!', 'success');
    });
}

function showToast(message, type = 'info') {
    const toast = document.getElementById('toast');
    document.getElementById('toast-message').innerText = message;
    
    const icon = document.getElementById('toast-icon');
    if (type === 'success') {
        icon.className = 'fa-solid fa-circle-check text-brand-400 text-xl';
        document.getElementById('toast-title').innerText = 'Success';
    } else if (type === 'error') {
        icon.className = 'fa-solid fa-triangle-exclamation text-red-400 text-xl';
        document.getElementById('toast-title').innerText = 'Error';
    } else {
        icon.className = 'fa-solid fa-circle-info text-blue-400 text-xl';
        document.getElementById('toast-title').innerText = 'Info';
    }

    toast.classList.add('toast-show');
    
    setTimeout(() => {
        toast.classList.remove('toast-show');
    }, 3000);
}

// --- API Logic ---
async function callGeminiAPI(prompt, isJson = false) {
    let apiKey = "AIzaSyD3NK-1q-0PcgWEzojciUloxnqLf8lwojc"; // Hardcoded from user
    const overrideKey = document.getElementById('override-api-key')?.value.trim();
    if (overrideKey) {
        apiKey = overrideKey;
    }

    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;
    
    const requestBody = {
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
            temperature: 0.2,
        }
    };

    if (isJson) {
        // Force JSON output via prompt engineering and response type if possible. 
        // For simple REST, prompt engineering is usually safer across model versions.
        requestBody.generationConfig.responseMimeType = "application/json";
    }

    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(requestBody)
        });

        if (!response.ok) {
            const errData = await response.json();
            throw new Error(errData.error?.message || 'API request failed');
        }

        const data = await response.json();
        const textResponse = data.candidates[0].content.parts[0].text;
        
        return textResponse;
    } catch (error) {
        console.error('Gemini API Error:', error);
        showToast(`API Error: ${error.message}`, 'error');
        throw error;
    }
}

// --- Core Processing Pipeline ---
async function processNotes() {
    const pwd = document.getElementById('app-password-input').value.trim();
    if (pwd !== '12341234') {
        showToast('Incorrect App Password. Please enter the correct password to unlock.', 'error');
        return;
    }

    const notes = document.getElementById('notes-input').value.trim();
    if (!notes) {
        showToast('Please paste some notes first.', 'error');
        return;
    }
    if (notes.length < 50) {
        showToast('Notes are too short. Please provide more context.', 'error');
        return;
    }

    const btn = document.getElementById('process-btn');
    const originalText = btn.innerHTML;
    btn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Processing...';
    btn.disabled = true;
    btn.classList.add('opacity-70', 'cursor-not-allowed');

    try {
        // 1. Generate Summary
        switchTab('summary');
        showLoadingState('summary');
        
        const summaryPrompt = `
        You are an expert tutor. Summarize the following study notes.
        Format the output in clean Markdown. Use headings, bullet points, and bold text for emphasis.
        Make it easy for a student to quickly review the core concepts.
        
        Notes:
        ${notes}
        `;
        
        const summaryMarkdown = await callGeminiAPI(summaryPrompt);
        generatedData.summary = summaryMarkdown;
        renderSummary(summaryMarkdown);

        // 2. Generate Flashcards
        switchTab('flashcards');
        showLoadingState('flashcards');
        
        const flashcardPrompt = `
        You are an expert tutor. Create 6 flashcards based on the following notes.
        Extract the most important definitions, concepts, or facts.
        
        Return ONLY a JSON array of objects with 'q' (question) and 'a' (answer/definition) keys.
        Example format: [{"q": "What is Mitochondria?", "a": "Powerhouse of the cell"}]
        
        Notes:
        ${notes}
        `;
        
        const flashcardJsonString = await callGeminiAPI(flashcardPrompt, true);
        const flashcards = JSON.parse(flashcardJsonString);
        generatedData.flashcards = flashcards;
        renderFlashcards(flashcards);

        // 3. Generate Quiz
        switchTab('quiz');
        showLoadingState('quiz');
        
        const quizPrompt = `
        You are an expert tutor. Create a 5-question multiple choice quiz based on the following notes.
        
        Return ONLY a JSON array of objects with the following structure:
        [
          {
            "question": "Question text here?",
            "options": ["A", "B", "C", "D"],
            "correctIndex": 1,
            "explanation": "Brief reason why this is correct."
          }
        ]
        (correctIndex is 0-indexed).
        
        Notes:
        ${notes}
        `;
        
        const quizJsonString = await callGeminiAPI(quizPrompt, true);
        const quiz = JSON.parse(quizJsonString);
        generatedData.quiz = quiz;
        
        // Reset quiz state and render
        quizState = { currentQuestionIndex: 0, score: 0, userAnswers: [] };
        renderQuizQuestion();

        showToast('All study materials generated successfully!', 'success');
        switchTab('summary'); // Go back to summary to start studying

    } catch (error) {
        console.error("Processing failed:", error);
        resetStatesOnError();
    } finally {
        btn.innerHTML = originalText;
        btn.disabled = false;
        btn.classList.remove('opacity-70', 'cursor-not-allowed');
    }
}

// --- UI Rendering Helpers ---

function showLoadingState(tab) {
    document.getElementById(`${tab}-empty`).classList.add('hidden');
    document.getElementById(`${tab}-content`)?.classList.add('hidden');
    document.getElementById(`${tab}-grid`)?.classList.add('hidden');
    document.getElementById(`${tab}-loading`).classList.remove('hidden');
    document.getElementById(`${tab}-loading`).classList.add('flex');
}

function resetStatesOnError() {
    if(!generatedData.summary) document.getElementById('summary-empty').classList.remove('hidden');
    document.getElementById('summary-loading').classList.add('hidden');
    
    if(!generatedData.flashcards) document.getElementById('flashcards-empty').classList.remove('hidden');
    document.getElementById('flashcards-loading').classList.add('hidden');
    
    if(!generatedData.quiz) document.getElementById('quiz-empty').classList.remove('hidden');
    document.getElementById('quiz-loading').classList.add('hidden');
}

// --- Summary View ---
function renderSummary(markdown) {
    const container = document.getElementById('summary-content');
    const loading = document.getElementById('summary-loading');
    
    // Use marked.js to parse markdown
    container.innerHTML = marked.parse(markdown);
    
    loading.classList.add('hidden');
    loading.classList.remove('flex');
    container.classList.remove('hidden');
}

// --- Flashcards View ---
function renderFlashcards(cards) {
    const grid = document.getElementById('flashcards-grid');
    const loading = document.getElementById('flashcards-loading');
    
    grid.innerHTML = ''; // Clear existing
    
    cards.forEach((card, index) => {
        const cardHtml = `
            <div class="flashcard-scene group" onclick="this.classList.toggle('is-flipped')">
                <div class="flashcard-inner shadow-lg">
                    <!-- Front -->
                    <div class="flashcard-front flex flex-col justify-center items-center text-center group-hover:border-brand-500/50 transition-colors">
                        <span class="absolute top-4 left-4 text-xs font-semibold text-slate-500">Q${index + 1}</span>
                        <i class="fa-regular fa-lightbulb text-2xl text-brand-400 mb-4 opacity-50"></i>
                        <h4 class="text-lg font-medium text-slate-200">${card.q}</h4>
                        <span class="absolute bottom-4 text-xs text-brand-500/70 font-medium tracking-wide uppercase"><i class="fa-solid fa-rotate mr-1"></i> Click to flip</span>
                    </div>
                    <!-- Back -->
                    <div class="flashcard-back flex flex-col justify-center items-center text-center">
                        <span class="absolute top-4 left-4 text-xs font-semibold text-teal-200/50">Answer</span>
                        <p class="text-white font-medium text-lg">${card.a}</p>
                    </div>
                </div>
            </div>
        `;
        grid.insertAdjacentHTML('beforeend', cardHtml);
    });

    loading.classList.add('hidden');
    loading.classList.remove('flex');
    grid.classList.remove('hidden');
}

// --- Quiz View ---
function renderQuizQuestion() {
    const quizData = generatedData.quiz;
    if (!quizData || quizData.length === 0) return;

    const currentQ = quizData[quizState.currentQuestionIndex];
    
    document.getElementById('quiz-loading').classList.add('hidden');
    document.getElementById('quiz-loading').classList.remove('flex');
    document.getElementById('quiz-empty').classList.add('hidden');
    document.getElementById('quiz-content').classList.remove('hidden');
    document.getElementById('quiz-content').classList.add('flex');
    document.getElementById('quiz-results').classList.add('hidden');

    // Update Header
    document.getElementById('quiz-current-q').innerText = quizState.currentQuestionIndex + 1;
    document.getElementById('quiz-total-q').innerText = quizData.length;
    document.getElementById('quiz-score').innerText = quizState.score;

    // Update Question
    document.getElementById('quiz-question-text').innerText = currentQ.question;
    
    // Update Options
    const optionsContainer = document.getElementById('quiz-options');
    optionsContainer.innerHTML = '';
    
    const labels = ['A', 'B', 'C', 'D'];
    
    currentQ.options.forEach((opt, index) => {
        const btnHtml = `
            <button onclick="selectQuizOption(${index})" id="opt-${index}" class="w-full text-left p-4 rounded-xl border border-slate-700 bg-slate-800/50 hover:bg-slate-700/50 text-slate-200 transition-all flex items-center gap-4 group">
                <span class="w-8 h-8 rounded-lg bg-slate-900 text-slate-400 flex items-center justify-center font-bold text-sm group-hover:text-brand-400 group-hover:bg-slate-800 transition-colors">${labels[index]}</span>
                <span class="flex-1">${opt}</span>
                <i id="icon-${index}" class="fa-solid hidden text-xl"></i>
            </button>
        `;
        optionsContainer.insertAdjacentHTML('beforeend', btnHtml);
    });

    // Hide feedback area initially
    document.getElementById('quiz-feedback-area').classList.add('hidden');
    document.getElementById('quiz-feedback-area').classList.remove('flex');
}

function selectQuizOption(selectedIndex) {
    // Prevent multiple selections
    if (document.getElementById('quiz-feedback-area').classList.contains('flex')) return;

    const quizData = generatedData.quiz;
    const currentQ = quizData[quizState.currentQuestionIndex];
    const isCorrect = selectedIndex === currentQ.correctIndex;

    // Disable all options
    currentQ.options.forEach((_, idx) => {
        const btn = document.getElementById(`opt-${idx}`);
        btn.classList.remove('hover:bg-slate-700/50', 'cursor-pointer');
        btn.classList.add('opacity-60', 'cursor-default');
    });

    // Highlight selected & correct
    const selectedBtn = document.getElementById(`opt-${selectedIndex}`);
    const correctBtn = document.getElementById(`opt-${currentQ.correctIndex}`);

    if (isCorrect) {
        quizState.score++;
        document.getElementById('quiz-score').innerText = quizState.score;
        selectedBtn.classList.replace('border-slate-700', 'border-brand-500');
        selectedBtn.classList.replace('bg-slate-800/50', 'bg-brand-500/20');
        selectedBtn.classList.remove('opacity-60');
        
        const icon = document.getElementById(`icon-${selectedIndex}`);
        icon.classList.remove('hidden');
        icon.classList.add('fa-circle-check', 'text-brand-500');
    } else {
        // Highlight wrong choice
        selectedBtn.classList.replace('border-slate-700', 'border-red-500');
        selectedBtn.classList.replace('bg-slate-800/50', 'bg-red-500/20');
        selectedBtn.classList.remove('opacity-60');
        
        const wrongIcon = document.getElementById(`icon-${selectedIndex}`);
        wrongIcon.classList.remove('hidden');
        wrongIcon.classList.add('fa-circle-xmark', 'text-red-500');

        // Highlight correct choice
        correctBtn.classList.replace('border-slate-700', 'border-brand-500');
        correctBtn.classList.replace('bg-slate-800/50', 'bg-brand-500/10');
        correctBtn.classList.remove('opacity-60');
        
        const correctIcon = document.getElementById(`icon-${currentQ.correctIndex}`);
        correctIcon.classList.remove('hidden');
        correctIcon.classList.add('fa-circle-check', 'text-brand-500');
    }

    // Show feedback
    const feedbackArea = document.getElementById('quiz-feedback-area');
    const feedbackText = document.getElementById('quiz-feedback-text');
    
    if (isCorrect) {
        feedbackText.innerHTML = `<span class="text-brand-400"><i class="fa-solid fa-check mr-2"></i>Correct!</span> ${currentQ.explanation}`;
    } else {
        feedbackText.innerHTML = `<span class="text-red-400"><i class="fa-solid fa-xmark mr-2"></i>Incorrect.</span> ${currentQ.explanation}`;
    }
    
    feedbackArea.classList.remove('hidden');
    feedbackArea.classList.add('flex', 'animation-fade-in');

    // Change button text if last question
    if (quizState.currentQuestionIndex === quizData.length - 1) {
        document.getElementById('quiz-next-btn').innerHTML = 'Finish Quiz <i class="fa-solid fa-flag-checkered ml-1"></i>';
    }
}

function nextQuizQuestion() {
    const quizData = generatedData.quiz;
    
    if (quizState.currentQuestionIndex < quizData.length - 1) {
        quizState.currentQuestionIndex++;
        renderQuizQuestion();
    } else {
        showQuizResults();
    }
}

function showQuizResults() {
    const quizData = generatedData.quiz;
    
    // Hide content areas
    document.getElementById('quiz-content').children[0].classList.add('hidden'); // Header
    document.getElementById('quiz-content').children[1].classList.add('hidden'); // Q Area
    document.getElementById('quiz-feedback-area').classList.add('hidden');
    document.getElementById('quiz-feedback-area').classList.remove('flex');
    
    // Show results
    const resultsArea = document.getElementById('quiz-results');
    resultsArea.classList.remove('hidden');
    resultsArea.classList.add('flex', 'animation-fade-in');
    
    document.getElementById('quiz-final-score').innerText = quizState.score;
    document.getElementById('quiz-final-total').innerText = quizData.length;
}

function resetQuiz() {
    quizState.currentQuestionIndex = 0;
    quizState.score = 0;
    
    // Restore content areas
    document.getElementById('quiz-content').children[0].classList.remove('hidden');
    document.getElementById('quiz-content').children[1].classList.remove('hidden');
    
    // Reset next button text
    document.getElementById('quiz-next-btn').innerHTML = 'Next Question <i class="fa-solid fa-arrow-right ml-1"></i>';
    
    renderQuizQuestion();
}

// --- File Upload Logic ---
async function handleFileUpload(event) {
    const file = event.target.files[0];
    if (!file) return;

    const notesInput = document.getElementById('notes-input');
    notesInput.value = 'Extracting text... please wait.';
    showToast(`Reading ${file.name}...`);

    try {
        if (file.name.endsWith('.pdf')) {
            const arrayBuffer = await file.arrayBuffer();
            const pdf = await pdfjsLib.getDocument(arrayBuffer).promise;
            let text = '';
            for (let i = 1; i <= pdf.numPages; i++) {
                const page = await pdf.getPage(i);
                const content = await page.getTextContent();
                text += content.items.map(item => item.str).join(' ') + '\n';
            }
            notesInput.value = text.trim();
            showToast('PDF text extracted successfully!', 'success');
        } else if (file.name.endsWith('.txt') || file.name.endsWith('.csv')) {
            const text = await file.text();
            notesInput.value = text.trim();
            showToast('File text extracted successfully!', 'success');
        } else {
            throw new Error('Unsupported file format. Please upload PDF, TXT, or CSV.');
        }
    } catch (error) {
        console.error('File reading error:', error);
        notesInput.value = '';
        showToast(error.message || 'Failed to read file.', 'error');
    }
    
    // Reset input so the same file can be uploaded again if needed
    event.target.value = '';
}
