// Telegram Web App SDK
const TELEGRAM_BOT_URL = "https://t.me/your_bot_username";

// Global state
let telegramAuth = null;
let isPhoneVerified = false;
let userPhoneNumber = '';
let currentCollectionData = null;

// Telegram Web App Authentication Class
class TelegramWebAppAuth {
    constructor() {
        this.tg = window.Telegram?.WebApp;
        this.isWebApp = !!this.tg;
        this.isPhoneVerified = false;
        this.userPhone = '';
        this.verificationCode = '';
        this.timerInterval = null;
        this.timeLeft = 60;
        
        this.init();
    }
    
    init() {
        if (this.isWebApp) {
            this.initializeWebApp();
        } else {
            this.initializeWebVersion();
        }
        
        this.bindEvents();
        this.checkExistingSession();
        this.loadCountries();
    }
    
    initializeWebApp() {
        try {
            this.tg.ready();
            this.tg.expand();
            this.tg.setHeaderColor('#18222d');
            this.tg.setBackgroundColor('#0f0f23');
            
            // Enable back button
            this.tg.BackButton.show();
            this.tg.BackButton.onClick(() => {
                this.hideAllModals();
            });
            
            console.log('Telegram Web App initialized');
            this.checkTelegramUserData();
            
        } catch (error) {
            console.error('Error initializing Telegram Web App:', error);
            this.initializeWebVersion();
        }
    }
    
    initializeWebVersion() {
        console.log('Running in regular web version');
    }
    
    checkTelegramUserData() {
        if (!this.tg?.initDataUnsafe?.user) return;
        
        const user = this.tg.initDataUnsafe.user;
        console.log('Telegram user data:', user);
        
        if (user?.phone_number) {
            this.userPhone = user.phone_number;
            this.showPhonePreview(this.userPhone);
        }
    }
    
    // Request phone number via Telegram Web App
    async requestPhoneNumber() {
        return new Promise((resolve, reject) => {
            if (!this.isWebApp) {
                this.showManualPhoneInput();
                reject(new Error('Telegram Web App not available'));
                return;
            }
            
            // Try different methods based on API version
            if (this.tg.requestContact) {
                this.requestPhoneViaContact(resolve, reject);
            } else if (this.tg.sharePhone) {
                this.requestPhoneViaShare(resolve, reject);
            } else {
                this.showManualPhoneInput();
                reject(new Error('Phone sharing not supported'));
            }
        });
    }
    
    requestPhoneViaContact(resolve, reject) {
        this.showLoadingState();
        
        this.tg.requestContact((isShared) => {
            this.hideLoadingState();
            
            if (isShared) {
                console.log('User shared contact');
                
                // Listen for contact data
                const contactHandler = (eventPayload) => {
                    if (eventPayload.status === 'sent' && eventPayload.auth_data?.phone_number) {
                        this.tg.offEvent('contactRequested', contactHandler);
                        this.processContactData(eventPayload.auth_data, resolve, reject);
                    }
                };
                
                this.tg.onEvent('contactRequested', contactHandler);
                
                // Timeout fallback
                setTimeout(() => {
                    this.tg.offEvent('contactRequested', contactHandler);
                    this.showManualPhoneInput();
                    reject(new Error('Contact request timeout'));
                }, 10000);
                
            } else {
                console.log('User declined to share contact');
                this.showManualPhoneInput();
                reject(new Error('User declined contact sharing'));
            }
        });
    }
    
    async requestPhoneViaShare(resolve, reject) {
        try {
            this.showLoadingState();
            const phone = await this.tg.sharePhone();
            this.hideLoadingState();
            
            if (phone) {
                this.userPhone = phone;
                await this.processPhoneNumber(this.userPhone);
                resolve(this.userPhone);
            } else {
                this.showManualPhoneInput();
                reject(new Error('No phone received'));
            }
        } catch (error) {
            this.hideLoadingState();
            console.error('Error sharing phone:', error);
            this.showManualPhoneInput();
            reject(error);
        }
    }
    
    async processContactData(authData, resolve, reject) {
        if (authData?.phone_number) {
            this.userPhone = authData.phone_number;
            console.log('Phone number received:', this.userPhone);
            
            try {
                const verified = await this.verifyTelegramData(authData);
                if (verified) {
                    await this.processPhoneNumber(this.userPhone);
                    resolve(this.userPhone);
                } else {
                    this.showError('Ошибка проверки данных');
                    reject(new Error('Verification failed'));
                }
            } catch (error) {
                console.error('Verification error:', error);
                this.showError('Ошибка проверки данных');
                reject(error);
            }
        }
    }
    
    async processPhoneNumber(phone) {
        this.userPhone = this.formatPhoneNumber(phone);
        this.showPhonePreview(this.userPhone);
        await this.sendVerificationCode();
    }
    
    async sendVerificationCode() {
        try {
            this.verificationCode = this.generateVerificationCode();
            
            // Send to Telegram bot if in Web App
            if (this.isWebApp && this.tg?.sendData) {
                const messageData = {
                    action: 'send_verification',
                    phone: this.userPhone,
                    code: this.verificationCode,
                    timestamp: Date.now()
                };
                this.tg.sendData(JSON.stringify(messageData));
            }
            
            this.showCodeVerificationModal();
            this.startVerificationTimer();
            
            // Demo: show code in console
            console.log('Demo verification code:', this.verificationCode);
            
        } catch (error) {
            console.error('Error sending verification code:', error);
            this.showError('Ошибка отправки кода');
        }
    }
    
    verifyCode(enteredCode) {
        if (enteredCode === this.verificationCode) {
            this.isPhoneVerified = true;
            this.saveSession();
            return true;
        }
        return false;
    }
    
    saveSession() {
        localStorage.setItem('tg_phone_verified', 'true');
        localStorage.setItem('tg_user_phone', this.userPhone);
        localStorage.setItem('tg_auth_time', Date.now().toString());
        this.updateAuthButton();
    }
    
    checkExistingSession() {
        const verified = localStorage.getItem('tg_phone_verified');
        const phone = localStorage.getItem('tg_user_phone');
        const authTime = localStorage.getItem('tg_auth_time');
        
        if (verified === 'true' && phone && authTime) {
            const sessionAge = Date.now() - parseInt(authTime);
            const maxSessionAge = 30 * 24 * 60 * 60 * 1000; // 30 дней
            
            if (sessionAge < maxSessionAge) {
                this.isPhoneVerified = true;
                this.userPhone = phone;
                this.updateAuthButton();
                return true;
            } else {
                this.clearSession();
            }
        }
        return false;
    }
    
    clearSession() {
        localStorage.removeItem('tg_phone_verified');
        localStorage.removeItem('tg_user_phone');
        localStorage.removeItem('tg_auth_time');
        this.isPhoneVerified = false;
        this.userPhone = '';
        this.updateAuthButton();
    }
    
    updateAuthButton() {
        const authBtn = document.getElementById('authBtn');
        const authBtnText = document.getElementById('authBtnText');
        
        if (this.isPhoneVerified && this.userPhone) {
            authBtnText.textContent = `✓ ${this.formatPhoneForDisplay(this.userPhone)}`;
            authBtn.classList.add('verified');
        } else {
            authBtnText.textContent = 'Войти';
            authBtn.classList.remove('verified');
        }
    }
    
    async verifyTelegramData(authData) {
        try {
            // In production, verify with your backend
            const response = await fetch('/api/verify-telegram-data', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(authData)
            });
            
            const result = await response.json();
            return result.verified === true;
            
        } catch (error) {
            console.error('Error verifying Telegram data:', error);
            // For demo, accept all data
            return true;
        }
    }
    
    formatPhoneNumber(phone) {
        return phone.replace(/\D/g, '');
    }
    
    formatPhoneForDisplay(phone) {
        const cleaned = phone.replace(/\D/g, '');
        if (cleaned.length === 11 && cleaned.startsWith('7')) {
            return `+7 ${cleaned.substring(1, 4)} ${cleaned.substring(4, 7)}-${cleaned.substring(7, 9)}-${cleaned.substring(9, 11)}`;
        }
        return phone;
    }
    
    generateVerificationCode() {
        return Math.floor(100000 + Math.random() * 900000).toString();
    }
    
    startVerificationTimer() {
        this.timeLeft = 60;
        const timerElement = document.getElementById('verificationTimer');
        const timeLeftElement = document.getElementById('verificationTimeLeft');
        const resendBtn = document.getElementById('resendCodeBtn');
        
        timerElement?.classList.add('active');
        if (resendBtn) resendBtn.disabled = true;
        
        if (this.timerInterval) {
            clearInterval(this.timerInterval);
        }
        
        this.timerInterval = setInterval(() => {
            this.timeLeft--;
            if (timeLeftElement) timeLeftElement.textContent = this.timeLeft;
            
            if (this.timeLeft <= 0) {
                clearInterval(this.timerInterval);
                timerElement?.classList.remove('active');
                if (timerElement) {
                    timerElement.innerHTML = 'Можете отправить код повторно';
                }
                if (resendBtn) resendBtn.disabled = false;
            }
        }, 1000);
    }
    
    // Country selection
    loadCountries() {
        const countries = [
            { code: 'RU', name: 'Россия', dial_code: '+7', emoji: '🇷🇺' },
            { code: 'UA', name: 'Украина', dial_code: '+380', emoji: '🇺🇦' },
            { code: 'BY', name: 'Беларусь', dial_code: '+375', emoji: '🇧🇾' },
            { code: 'KZ', name: 'Казахстан', dial_code: '+7', emoji: '🇰🇿' },
            { code: 'US', name: 'США', dial_code: '+1', emoji: '🇺🇸' },
            { code: 'GB', name: 'Великобритания', dial_code: '+44', emoji: '🇬🇧' },
            { code: 'DE', name: 'Германия', dial_code: '+49', emoji: '🇩🇪' },
            { code: 'FR', name: 'Франция', dial_code: '+33', emoji: '🇫🇷' },
            { code: 'IT', name: 'Италия', dial_code: '+39', emoji: '🇮🇹' },
            { code: 'ES', name: 'Испания', dial_code: '+34', emoji: '🇪🇸' }
        ];
        
        const countryList = document.getElementById('countryList');
        if (!countryList) return;
        
        countryList.innerHTML = '';
        
        countries.forEach(country => {
            const item = document.createElement('div');
            item.className = `country-item ${country.code === 'RU' ? 'active' : ''}`;
            item.dataset.code = country.code;
            item.dataset.dialCode = country.dial_code;
            item.dataset.emoji = country.emoji;
            item.dataset.name = country.name;
            
            item.innerHTML = `
                <div class="country-item-flag">${country.emoji}</div>
                <div class="country-item-name">${country.name}</div>
                <div class="country-item-code">${country.dial_code}</div>
            `;
            
            item.addEventListener('click', () => this.selectCountry(country));
            countryList.appendChild(item);
        });
    }
    
    selectCountry(country) {
        document.getElementById('selectedFlag').textContent = country.emoji;
        document.getElementById('selectedCode').textContent = country.dial_code;
        this.hideCountryDropdown();
    }
    
    toggleCountryDropdown() {
        const dropdown = document.getElementById('countryDropdown');
        if (dropdown) {
            dropdown.classList.toggle('show');
            if (dropdown.classList.contains('show')) {
                document.getElementById('countrySearch')?.focus();
            }
        }
    }
    
    hideCountryDropdown() {
        const dropdown = document.getElementById('countryDropdown');
        if (dropdown) dropdown.classList.remove('show');
    }
    
    filterCountries(searchTerm) {
        const items = document.querySelectorAll('.country-item');
        const term = searchTerm.toLowerCase();
        
        items.forEach(item => {
            const name = item.dataset.name.toLowerCase();
            const code = item.dataset.dialCode;
            
            if (name.includes(term) || code.includes(term)) {
                item.style.display = 'flex';
            } else {
                item.style.display = 'none';
            }
        });
    }
    
    // Modal controls
    showPhoneRequestModal() {
        document.getElementById('phoneRequestModal').style.display = 'flex';
    }
    
    hidePhoneRequestModal() {
        document.getElementById('phoneRequestModal').style.display = 'none';
    }
    
    showCodeVerificationModal() {
        this.hidePhoneRequestModal();
        document.getElementById('codeVerificationModal').style.display = 'flex';
        
        const phoneDisplay = document.getElementById('verificationPhoneDisplay');
        if (phoneDisplay) {
            phoneDisplay.textContent = this.formatPhoneForDisplay(this.userPhone);
        }
    }
    
    hideCodeVerificationModal() {
        document.getElementById('codeVerificationModal').style.display = 'none';
    }
    
    showSuccessModal() {
        this.hideCodeVerificationModal();
        document.getElementById('successModal').style.display = 'flex';
        
        const confirmedPhone = document.getElementById('confirmedPhoneNumber');
        if (confirmedPhone) {
            confirmedPhone.textContent = this.formatPhoneForDisplay(this.userPhone);
        }
    }
    
    hideSuccessModal() {
        document.getElementById('successModal').style.display = 'none';
    }
    
    showLoginModal() {
        document.getElementById('loginModal').style.display = 'flex';
    }
    
    hideLoginModal() {
        document.getElementById('loginModal').style.display = 'none';
    }
    
    showLoadingState() {
        const loadingState = document.getElementById('phoneLoadingState');
        if (loadingState) loadingState.style.display = 'block';
        
        const errorState = document.getElementById('phoneErrorState');
        if (errorState) errorState.style.display = 'none';
    }
    
    hideLoadingState() {
        const loadingState = document.getElementById('phoneLoadingState');
        if (loadingState) loadingState.style.display = 'none';
    }
    
    showError(message) {
        const errorElement = document.getElementById('errorMessage');
        if (errorElement) errorElement.textContent = message;
        
        const errorState = document.getElementById('phoneErrorState');
        if (errorState) errorState.style.display = 'block';
    }
    
    hideError() {
        const errorState = document.getElementById('phoneErrorState');
        if (errorState) errorState.style.display = 'none';
    }
    
    showPhonePreview(phone) {
        const previewElement = document.getElementById('phonePreview');
        const phoneNumberElement = document.getElementById('detectedPhoneNumber');
        
        if (previewElement && phoneNumberElement) {
            phoneNumberElement.textContent = this.formatPhoneForDisplay(phone);
            previewElement.style.display = 'block';
        }
    }
    
    showManualPhoneInput() {
        const requestContent = document.querySelector('.phone-request-content');
        const manualInput = document.getElementById('manualPhoneInput');
        
        if (requestContent) requestContent.style.display = 'none';
        if (manualInput) manualInput.style.display = 'block';
    }
    
    hideManualPhoneInput() {
        const requestContent = document.querySelector('.phone-request-content');
        const manualInput = document.getElementById('manualPhoneInput');
        
        if (requestContent) requestContent.style.display = 'block';
        if (manualInput) manualInput.style.display = 'none';
    }
    
    hideAllModals() {
        this.hidePhoneRequestModal();
        this.hideCodeVerificationModal();
        this.hideSuccessModal();
        this.hideLoginModal();
    }
    
    bindEvents() {
        // Phone request button
        document.getElementById('requestPhoneBtn')?.addEventListener('click', () => {
            this.requestPhoneNumber().catch(() => {
                this.showManualPhoneInput();
            });
        });
        
        // Manual phone button
        document.getElementById('manualPhoneBtn')?.addEventListener('click', () => {
            this.showManualPhoneInput();
        });
        
        // Back to request
        document.getElementById('backToRequestBtn')?.addEventListener('click', () => {
            this.hideManualPhoneInput();
        });
        
        // Submit manual phone
        document.getElementById('submitManualPhoneBtn')?.addEventListener('click', () => {
            this.processManualPhone();
        });
        
        // Resend code
        document.getElementById('resendCodeBtn')?.addEventListener('click', () => {
            this.sendVerificationCode();
        });
        
        // Verify code
        document.getElementById('verifyCodeBtn')?.addEventListener('click', () => {
            this.verifyEnteredCode();
        });
        
        // Continue to collections
        document.getElementById('continueToCollectionsBtn')?.addEventListener('click', () => {
            this.hideSuccessModal();
            this.updateAuthButton();
            
            // Load collection if requested
            const collectionInput = document.getElementById('collectionInput');
            if (collectionInput?.value) {
                loadCollection(collectionInput.value);
            }
        });
        
        // Close buttons
        document.getElementById('closePhoneRequestBtn')?.addEventListener('click', () => {
            this.hidePhoneRequestModal();
        });
        
        document.getElementById('closeLoginModalBtn')?.addEventListener('click', () => {
            this.hideLoginModal();
        });
        
        document.getElementById('showPhoneRequestBtn')?.addEventListener('click', () => {
            this.hideLoginModal();
            this.showPhoneRequestModal();
        });
        
        document.getElementById('retryPhoneBtn')?.addEventListener('click', () => {
            this.hideError();
            this.requestPhoneNumber();
        });
        
        // Country selector
        document.getElementById('countrySelector')?.addEventListener('click', (e) => {
            e.stopPropagation();
            this.toggleCountryDropdown();
        });
        
        // Country search
        document.getElementById('countrySearch')?.addEventListener('input', (e) => {
            this.filterCountries(e.target.value);
        });
        
        // Close dropdown on outside click
        document.addEventListener('click', (e) => {
            if (!e.target.closest('.country-selector') && !e.target.closest('.country-dropdown')) {
                this.hideCountryDropdown();
            }
        });
        
        // Phone input formatting
        document.getElementById('manualPhoneField')?.addEventListener('input', (e) => {
            this.formatPhoneInput(e.target);
        });
        
        // Auth button
        document.getElementById('authBtn')?.addEventListener('click', () => {
            if (this.isPhoneVerified) {
                alert(`Номер подтвержден: ${this.formatPhoneForDisplay(this.userPhone)}`);
            } else {
                this.showPhoneRequestModal();
            }
        });
        
        // Initialize code inputs
        this.initCodeInputs();
    }
    
    initCodeInputs() {
        const inputs = document.querySelectorAll('.code-input');
        
        inputs.forEach((input, index) => {
            input.addEventListener('input', (e) => {
                const value = e.target.value;
                
                if (!/^\d?$/.test(value)) {
                    e.target.value = '';
                    return;
                }
                
                if (value && index < inputs.length - 1) {
                    inputs[index + 1].focus();
                }
                
                this.checkCodeCompletion();
            });
            
            input.addEventListener('keydown', (e) => {
                if (e.key === 'Backspace' && !e.target.value && index > 0) {
                    inputs[index - 1].focus();
                }
            });
            
            input.addEventListener('paste', (e) => {
                e.preventDefault();
                const paste = e.clipboardData.getData('text').replace(/\D/g, '');
                
                if (paste.length === 6) {
                    paste.split('').forEach((char, i) => {
                        if (inputs[i]) {
                            inputs[i].value = char;
                            inputs[i].classList.add('filled');
                        }
                    });
                    this.checkCodeCompletion();
                }
            });
        });
    }
    
    checkCodeCompletion() {
        const inputs = document.querySelectorAll('.code-input');
        let code = '';
        
        inputs.forEach(input => {
            code += input.value;
            input.classList.toggle('filled', input.value !== '');
        });
        
        const verifyBtn = document.getElementById('verifyCodeBtn');
        if (verifyBtn) verifyBtn.disabled = code.length !== 6;
    }
    
    verifyEnteredCode() {
        const inputs = document.querySelectorAll('.code-input');
        let enteredCode = '';
        
        inputs.forEach(input => {
            enteredCode += input.value;
        });
        
        if (this.verifyCode(enteredCode)) {
            this.showSuccessModal();
        } else {
            alert('Неверный код подтверждения. Попробуйте еще раз.');
            
            inputs.forEach(input => {
                input.value = '';
                input.classList.remove('filled');
            });
            
            if (inputs[0]) inputs[0].focus();
        }
    }
    
    formatPhoneInput(input) {
        let value = input.value.replace(/\D/g, '');
        
        if (value.length > 0) value = value.substring(0, 10);
        if (value.length > 3) value = value.replace(/^(\d{3})(\d{0,3})?(\d{0,2})?(\d{0,2})?/, 
            (match, p1, p2, p3, p4) => {
                let result = p1;
                if (p2) result += ' ' + p2;
                if (p3) result += '-' + p3;
                if (p4) result += '-' + p4;
                return result;
            });
        
        input.value = value;
    }
    
    processManualPhone() {
        const phoneInput = document.getElementById('manualPhoneField');
        if (!phoneInput) return;
        
        const phoneDigits = phoneInput.value.replace(/\D/g, '');
        
        if (phoneDigits.length < 10) {
            alert('Введите корректный номер телефона (10 цифр)');
            return;
        }
        
        const countryCode = document.getElementById('selectedCode')?.textContent?.replace('+', '') || '7';
        this.userPhone = countryCode + phoneDigits;
        
        this.processPhoneNumber(this.userPhone);
    }
}

// Collection functions
function formatCollectionName(name) {
    return name.replace(/'/g, '').replace(/\s+/g, '').replace(/[^\w\s]/gi, '');
}

function getRarityName(rarity) {
    const rarityMap = {
        2: 'Mythic',
        3: 'Legendary',
        4: 'Epic',
        5: 'Rare',
        8: 'Uncommon',
        10: 'Common',
        12: 'Basic',
        13: 'Standard',
        15: 'Regular',
        18: 'Normal',
        20: 'Basic'
    };
    return rarityMap[rarity] || 'Rare ' + rarity;
}

function generateModelImageUrl(modelName, size = 512) {
    const formattedName = modelName
        .toLowerCase()
        .replace(/[^a-z0-9]/g, '_')
        .replace(/_+/g, '_')
        .replace(/^_|_$/g, '');
    return `https://api.changes.tg/model/collection/${formattedName}.png?size=${size}`;
}

function generateTelegramLink(collectionName, nftName) {
    const randomNum = Math.floor(Math.random() * 10000) + 1000;
    const formattedCollection = formatCollectionName(collectionName);
    const formattedNFT = nftName.replace(/\s+/g, '').substring(0, 20);
    return `https://t.me/nft/${formattedCollection}-${formattedNFT}-${randomNum}`;
}

// Check authentication before loading collection
async function checkAuthBeforeLoad() {
    if (!telegramAuth?.isPhoneVerified) {
        telegramAuth?.showLoginModal();
        return false;
    }
    return true;
}

// Load collection from API
async function loadCollection(collectionName) {
    // Check authentication
    const canLoad = await checkAuthBeforeLoad();
    if (!canLoad) return;
    
    const loader = document.getElementById('loader');
    const nftGrid = document.getElementById('nftGrid');
    const noResults = document.getElementById('noResults');
    const collectionTitle = document.getElementById('collectionTitle');
    const currentCollection = document.getElementById('currentCollection');
    const loadBtn = document.getElementById('loadCollectionBtn');
    const input = document.getElementById('collectionInput');
    
    // Update UI
    loader.classList.add('active');
    loadBtn.disabled = true;
    loadBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Loading...';
    nftGrid.innerHTML = '';
    noResults.style.display = 'none';
    
    // Show current collection info
    collectionTitle.textContent = `Collection: ${collectionName}`;
    currentCollection.style.display = 'block';
    
    try {
        const formattedName = formatCollectionName(collectionName);
        const apiUrl = `https://app-api.xgift.tg/gifts/filters/${formattedName}?collectionType=upgradable`;
        
        console.log(`Fetching from: ${apiUrl}`);
        
        const response = await fetch(apiUrl, {
            headers: {
                'Accept': 'application/json',
                'Content-Type': 'application/json'
            }
        });
        
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        const data = await response.json();
        console.log('API Response:', data);
        
        currentCollectionData = data;
        
        // Process and display NFTs
        const allNFTs = [];
        let totalVolume = 0;
        let totalPrice = 0;
        
        // Process gift models
        if (data.giftModel && Array.isArray(data.giftModel)) {
            data.giftModel.forEach(gift => {
                const price = parseFloat(gift.floorPriceTon || gift.avg30dPrice || '0');
                const nft = {
                    id: gift.id,
                    type: 'giftModel',
                    name: gift.model || gift.modelNameFormatted || 'Unknown Model',
                    collection: collectionName,
                    rarity: gift.modelRare || 10,
                    count: gift.modelCount || 0,
                    price: price,
                    avg30dPrice: parseFloat(gift.avg30dPrice || '0'),
                    deals30d: gift.deals30dCount || 0,
                    onSale: gift.onSaleCount || 0,
                    modelImageUrl: generateModelImageUrl(gift.model || gift.modelNameFormatted || 'Model'),
                    telegramLink: generateTelegramLink(collectionName, gift.model || 'Model')
                };
                allNFTs.push(nft);
                totalVolume += price * (gift.modelCount || 0);
                totalPrice += price;
            });
        }
        
        // Process gift backdrops
        if (data.giftBackdrop && Array.isArray(data.giftBackdrop)) {
            data.giftBackdrop.forEach(backdrop => {
                const price = parseFloat(backdrop.floorPriceTon || backdrop.avg30dPrice || '0');
                const nft = {
                    id: backdrop.id,
                    type: 'giftBackdrop',
                    name: backdrop.backdrop || 'Unknown Backdrop',
                    collection: collectionName,
                    rarity: backdrop.backdropRare || 10,
                    count: backdrop.backdropCount || 0,
                    price: price,
                    avg30dPrice: parseFloat(backdrop.avg30dPrice || '0'),
                    deals30d: backdrop.deals30dCount || 0,
                    onSale: backdrop.onSaleCount || 0,
                    modelImageUrl: generateModelImageUrl(backdrop.backdrop || 'Backdrop'),
                    telegramLink: generateTelegramLink(collectionName, backdrop.backdrop || 'Backdrop')
                };
                allNFTs.push(nft);
                totalVolume += price * (backdrop.backdropCount || 0);
                totalPrice += price;
            });
        }
        
        // Process gift symbols
        if (data.giftSymbol && Array.isArray(data.giftSymbol)) {
            data.giftSymbol.forEach(symbol => {
                const price = parseFloat(symbol.floorPriceTon || symbol.avg30dPrice || '0');
                const nft = {
                    id: symbol.id,
                    type: 'giftSymbol',
                    name: symbol.pattern || 'Unknown Symbol',
                    collection: collectionName,
                    rarity: symbol.patternRare || 10,
                    count: symbol.patternCount || 0,
                    price: price,
                    avg30dPrice: parseFloat(symbol.avg30dPrice || '0'),
                    deals30d: symbol.deals30dCount || 0,
                    onSale: symbol.onSaleCount || 0,
                    modelImageUrl: generateModelImageUrl(symbol.pattern || 'Symbol'),
                    telegramLink: generateTelegramLink(collectionName, symbol.pattern || 'Symbol')
                };
                allNFTs.push(nft);
                totalVolume += price * (symbol.patternCount || 0);
                totalPrice += price;
            });
        }
        
        console.log(`Loaded ${allNFTs.length} NFTs from collection ${collectionName}`);
        
        // Update global stats
        updateStats(allNFTs, totalVolume);
        
        // Update collection stats
        updateCollectionStats(allNFTs, totalVolume);
        
        if (allNFTs.length === 0) {
            noResults.style.display = 'block';
            currentCollection.style.display = 'none';
        } else {
            renderNFTs(allNFTs);
            applyFilters();
        }
        
        // Reset button
        loadBtn.disabled = false;
        loadBtn.innerHTML = '<i class="fas fa-rocket"></i> Load';
        loader.classList.remove('active');
        
    } catch (error) {
        console.error('Error loading collection:', error);
        loader.classList.remove('active');
        noResults.style.display = 'block';
        noResults.innerHTML = `<i class="fas fa-exclamation-triangle fa-3x" style="margin-bottom: 15px;"></i>
                              <p>Error loading collection</p>
                              <p class="sub-message">${error.message}</p>`;
        currentCollection.style.display = 'none';
        
        // Reset button
        loadBtn.disabled = false;
        loadBtn.innerHTML = '<i class="fas fa-rocket"></i> Load';
    }
}

// Update global stats
function updateStats(nfts, totalVolume) {
    const totalNFTs = document.getElementById('totalNFTs');
    const avgPriceElem = document.getElementById('avgPrice');
    const collectionsCount = document.getElementById('collectionsCount');
    const totalVolumeElem = document.getElementById('totalVolume');
    
    const avgPrice = nfts.length > 0 ? nfts.reduce((sum, nft) => sum + nft.price, 0) / nfts.length : 0;
    
    // Animate stats update
    totalNFTs.textContent = nfts.length.toLocaleString();
    avgPriceElem.textContent = `₮${avgPrice.toFixed(2)}`;
    totalVolumeElem.textContent = `₮${totalVolume.toFixed(0)}`;
    
    // Add animation
    [totalNFTs, avgPriceElem, totalVolumeElem].forEach(elem => {
        elem.classList.add('updated');
        setTimeout(() => elem.classList.remove('updated'), 500);
    });
}

// Update collection stats
function updateCollectionStats(nfts, totalVolume) {
    const collectionStats = document.querySelector('.collection-stats');
    const avgPrice = nfts.length > 0 ? nfts.reduce((sum, nft) => sum + nft.price, 0) / nfts.length : 0;
    const avgRarity = nfts.length > 0 ? nfts.reduce((sum, nft) => sum + nft.rarity, 0) / nfts.length : 0;
    const totalDeals = nfts.reduce((sum, nft) => sum + nft.deals30d, 0);
    
    if (!collectionStats) return;
    
    collectionStats.innerHTML = `
        <div class="collection-stat">
            <div class="collection-stat-value">${nfts.length}</div>
            <div class="collection-stat-label">Total Items</div>
        </div>
        <div class="collection-stat">
            <div class="collection-stat-value">₮${avgPrice.toFixed(2)}</div>
            <div class="collection-stat-label">Avg Price</div>
        </div>
        <div class="collection-stat">
            <div class="collection-stat-value">${totalDeals}</div>
            <div class="collection-stat-label">30d Deals</div>
        </div>
        <div class="collection-stat">
            <div class="collection-stat-value">${getRarityName(Math.round(avgRarity))}</div>
            <div class="collection-stat-label">Avg Rarity</div>
        </div>
    `;
}

// Render NFT cards
function renderNFTs(nfts) {
    const nftGrid = document.getElementById('nftGrid');
    if (!nftGrid) return;
    
    nfts.forEach((nft, index) => {
        setTimeout(() => {
            const nftCard = document.createElement('div');
            nftCard.className = `nft-card rare-${nft.rarity}`;
            
            // Format prices
            const price = nft.price.toFixed(2);
            const avgPrice = nft.avg30dPrice.toFixed(2);
            
            // Determine if trending (based on deals count)
            const isTrending = nft.deals30d > 30;
            
            // Get rarity name
            const rarityName = getRarityName(nft.rarity);
            
            nftCard.innerHTML = `
                ${isTrending ? '<div class="trending-badge">🔥 TRENDING</div>' : ''}
                <div class="rarity-badge" style="background: var(--rare-${nft.rarity})">
                    ${rarityName}
                </div>
                
                <div class="nft-header">
                    <div class="nft-title">${nft.name}</div>
                    <div class="nft-collection">
                        <span class="collection-badge">${nft.collection}</span>
                        <span class="type-tag ${nft.type === 'giftModel' ? 'type-gift' : nft.type === 'giftBackdrop' ? 'type-backdrop' : 'type-symbol'}">
                            <i class="fas ${nft.type === 'giftModel' ? 'fa-gift' : nft.type === 'giftBackdrop' ? 'fa-square' : 'fa-shapes'}"></i>
                            ${nft.type === 'giftModel' ? 'Model' : nft.type === 'giftBackdrop' ? 'Backdrop' : 'Symbol'}
                        </span>
                    </div>
                </div>
                
                <div class="nft-image">
                    <img src="${nft.modelImageUrl}" alt="${nft.name}" class="nft-preview" onerror="this.onerror=null; this.src='https://via.placeholder.com/300x200/1a1a2e/ffffff?text=NFT+Preview';">
                </div>
                
                <div class="nft-content">
                    <div class="nft-details">
                        <div class="detail-item">
                            <div class="detail-label">Rarity</div>
                            <div class="detail-value">${rarityName}</div>
                        </div>
                        <div class="detail-item">
                            <div class="detail-label">Supply</div>
                            <div class="detail-value">${nft.count.toLocaleString()}</div>
                        </div>
                        <div class="detail-item">
                            <div class="detail-label">30d Deals</div>
                            <div class="detail-value">${nft.deals30d}</div>
                        </div>
                        <div class="detail-item">
                            <div class="detail-label">On Sale</div>
                            <div class="detail-value">${nft.onSale}</div>
                        </div>
                    </div>
                    
                    <div class="price-section">
                        <div class="price-row">
                            <div class="price-label">Floor Price</div>
                            <div class="floor-price">₮${price}</div>
                        </div>
                        <div class="price-row">
                            <div class="price-label">30d Avg Price</div>
                            <div class="price-value">₮${avgPrice}</div>
                        </div>
                    </div>
                    
                    <a href="${nft.telegramLink}" target="_blank" class="fragment-link">
                        <i class="fab fa-telegram"></i>
                        View on Telegram
                    </a>
                </div>
            `;
            
            nftCard.dataset.name = nft.name.toLowerCase();
            nftCard.dataset.rarity = nft.rarity;
            nftCard.dataset.type = nft.type;
            nftCard.dataset.deals = nft.deals30d;
            nftCard.dataset.price = nft.price;
            nftCard.dataset.trending = isTrending;
            
            nftGrid.appendChild(nftCard);
        }, index * 50);
    });
}

// Apply filters
function applyFilters() {
    const activeFilter = document.querySelector('.filter-btn.active')?.dataset.filter || 'all';
    const nftCards = document.querySelectorAll('.nft-card');
    let visibleCount = 0;
    
    nftCards.forEach(card => {
        const rarity = parseInt(card.dataset.rarity);
        const price = parseFloat(card.dataset.price);
        const isTrending = card.dataset.trending === 'true';
        
        let shouldShow = true;
        
        // Apply active filter
        if (activeFilter !== 'all') {
            switch (activeFilter) {
                case 'rare':
                    shouldShow = rarity <= 5;
                    break;
                case 'trending':
                    shouldShow = isTrending;
                    break;
                case 'cheap':
                    shouldShow = price < 5;
                    break;
                case 'expensive':
                    shouldShow = price >= 10;
                    break;
            }
        }
        
        card.style.display = shouldShow ? 'block' : 'none';
        if (shouldShow) visibleCount++;
    });
    
    // Show/hide no results message
    const noResults = document.getElementById('noResults');
    if (visibleCount === 0 && nftCards.length > 0) {
        noResults.style.display = 'block';
        noResults.innerHTML = '<i class="fas fa-filter fa-3x" style="margin-bottom: 15px;"></i><p>No gifts match this filter</p><p class="sub-message">Try a different filter</p>';
    } else {
        noResults.style.display = 'none';
    }
}

// Initialize the page
document.addEventListener('DOMContentLoaded', () => {
    // Initialize Telegram auth
    telegramAuth = new TelegramWebAppAuth();
    
    // Load collection button
    const loadBtn = document.getElementById('loadCollectionBtn');
    const input = document.getElementById('collectionInput');
    
    loadBtn?.addEventListener('click', () => {
        const collectionName = input.value.trim();
        if (collectionName) {
            loadCollection(collectionName);
        }
    });
    
    // Enter key support
    input?.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            const collectionName = input.value.trim();
            if (collectionName) {
                loadCollection(collectionName);
            }
        }
    });
    
    // Example buttons
    document.querySelectorAll('.example-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const collection = btn.dataset.collection;
            if (input) input.value = collection;
            loadCollection(collection);
        });
    });
    
    // Filter button click handlers
    document.querySelectorAll('.filter-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            applyFilters();
        });
    });
    
    // Load default collection if already verified
    setTimeout(() => {
        if (telegramAuth?.isPhoneVerified) {
            const collectionInput = document.getElementById('collectionInput');
            if (collectionInput) {
                collectionInput.value = 'LunarSnake';
                loadCollection('LunarSnake');
            }
        }
    }, 1000);
    
    // Initialize code inputs on page load
    setTimeout(() => {
        const inputs = document.querySelectorAll('.code-input');
        inputs.forEach(input => {
            input.addEventListener('input', function(e) {
                const value = e.target.value;
                if (!/^\d?$/.test(value)) {
                    e.target.value = '';
                    return;
                }
                
                const nextInput = this.nextElementSibling;
                if (value && nextInput && nextInput.classList.contains('code-input')) {
                    nextInput.focus();
                }
                
                // Check if all inputs are filled
                const allInputs = document.querySelectorAll('.code-input');
                const allFilled = Array.from(allInputs).every(input => input.value.length === 1);
                if (allFilled) {
                    const verifyBtn = document.getElementById('verifyCodeBtn');
                    if (verifyBtn) verifyBtn.disabled = false;
                }
            });
            
            input.addEventListener('keydown', function(e) {
                if (e.key === 'Backspace' && !this.value && this.previousElementSibling) {
                    this.previousElementSibling.focus();
                }
            });
        });
    }, 500);
});