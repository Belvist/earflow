import SwiftUI

struct PlayerView: View {
    @EnvironmentObject private var dependencies: AppDependencies
    @State private var playbackState: PlaybackState = .idle
    @State private var trackIdInput = "1"

    var body: some View {
        NavigationStack {
            VStack(spacing: 24) {
                Text(playbackState.rawValue)
                    .font(.headline.monospaced())
                TextField("Track ID", text: $trackIdInput)
                    .keyboardType(.numberPad)
                    .textFieldStyle(.roundedBorder)
                    .padding(.horizontal)
                HStack(spacing: 16) {
                    Button("Play") {
                        guard let id = Int(trackIdInput) else { return }
                        Task { await dependencies.playback.play(trackId: id) }
                    }
                    .buttonStyle(.borderedProminent)
                    Button("Pause") {
                        Task { await dependencies.playback.pause() }
                    }
                    .buttonStyle(.bordered)
                    Button("Stop") {
                        Task { await dependencies.playback.stop() }
                    }
                    .buttonStyle(.bordered)
                }
                Spacer()
            }
            .padding(.top, 32)
            .navigationTitle("Player")
            .task {
                for await state in dependencies.playback.stateStream() {
                    playbackState = state
                }
            }
        }
    }
}
